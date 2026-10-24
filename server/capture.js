import { randomBytes, createHash, randomInt } from 'node:crypto';
import { parse, serialize } from 'cookie';
import multer from 'multer';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

const token = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value || '').digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
export const LIMITS = { photoBytes: 8 * 1024 ** 2, photos: 24, assetBytes: 32 * 1024 ** 2, totalBytes: 192 * 1024 ** 2 };

export function validateGLB(buffer) {
  if (buffer.length < 20 || buffer.length > LIMITS.assetBytes || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length || buffer.readUInt32LE(16) !== 0x4e4f534a) throw fail(422, 'Expected a valid GLB 2.0 asset (maximum 32 MB).');
  const length = buffer.readUInt32LE(12);
  if (length > buffer.length - 20) throw fail(422, 'Invalid GLB JSON chunk.');
  let document;
  try { document = JSON.parse(buffer.toString('utf8', 20, 20 + length)); } catch { throw fail(422, 'Invalid GLB metadata.'); }
  if (!document.meshes?.length) throw fail(422, 'The reconstruction contains no mesh.');
  for (const resource of [...(document.buffers || []), ...(document.images || [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw fail(422, 'GLB assets must embed all textures and buffers.');
  }
  return document;
}

export function installCapture(app, server, options = {}) {
  const now = options.now || Date.now;
  const origin = options.origin || 'http://localhost:3000';
  const secure = origin.startsWith('https:');
  const inviteMs = options.inviteMs || 10 * 60_000;
  const lifetimeMs = options.lifetimeMs || 60 * 60_000;
  const sessions = new Map();
  const rates = new Map();
  const workerUrl = options.workerUrl || '';
  const workerToken = options.workerToken || '';
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let bytes = 0;
  let activeUploads = 0;
  const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 3600 };
  const cookies = req => parse(req.headers.cookie || '');
  const publicPhone = p => ({ id: p.id, name: p.name, status: p.status, verification: p.verification });
  const snapshot = (s, role, phone) => ({
    id: s.id, expiresAt: s.expiresAt, inviteExpiresAt: s.inviteExpiresAt,
    phone: phone ? publicPhone(phone) : undefined,
    phones: role === 'owner' ? [...s.phones.values()].map(publicPhone) : undefined,
    captures: role === 'owner' || phone?.status === 'approved' ? [...s.photos.values()].map(p => ({ id: p.id, mode: p.mode, width: p.width, height: p.height, createdAt: p.createdAt, url: `/api/sessions/${s.id}/photos/${p.id}` })) : [],
    job: role === 'owner' || phone?.status === 'approved' ? s.job : null,
  });
  function emit(s) {
    for (const ws of wss.clients) if (ws.session === s && ws.readyState === 1) ws.send(JSON.stringify({ type: 'snapshot', ...snapshot(s, ws.role, ws.phone) }));
  }
  function dropPhoto(s, id) {
    const photo = s.photos.get(id);
    if (photo) { bytes -= photo.data.length; s.photos.delete(id); }
  }
  function destroy(s) {
    s.controller?.abort();
    for (const id of s.photos.keys()) dropPhoto(s, id);
    if (s.asset) bytes -= s.asset.length;
    sessions.delete(s.id);
    for (const ws of wss.clients) if (ws.session === s) { ws.send(JSON.stringify({ type: 'expired' })); ws.close(4001, 'Session ended'); }
  }
  function sweep() {
    for (const s of sessions.values()) {
      if (s.expiresAt <= now()) { destroy(s); continue; }
      let changed = false;
      for (const p of s.photos.values()) if (now() - p.createdAt > 30 * 60_000 && s.job?.status !== 'running') { dropPhoto(s, p.id); changed = true; }
      if (changed) emit(s);
    }
    for (const [key, rate] of rates) if (rate.until <= now()) rates.delete(key);
  }
  function rateLimit(req, key, limit) {
    const id = `${req.ip || req.socket.remoteAddress}:${key}`;
    const rate = rates.get(id) || { count: 0, until: now() + 60_000 };
    if (rate.until <= now()) { rate.count = 0; rate.until = now() + 60_000; }
    rate.count++; rates.set(id, rate);
    if (rate.count > limit) throw fail(429, 'Too many attempts. Please try again in a minute.');
  }
  function getSession(req) {
    const s = sessions.get(req.params.id);
    if (!s || s.expiresAt <= now()) throw fail(410, 'This capture session has ended. Start a new session on your desktop.');
    return s;
  }
  function identity(req, s, ownerOnly = false) {
    const c = cookies(req);
    if (c.rs_owner && hash(c.rs_owner) === s.owner) return { role: 'owner' };
    if (!ownerOnly && c.rs_phone) {
      const phone = [...s.phones.values()].find(p => p.secret === hash(c.rs_phone));
      if (phone && ['pending', 'approved'].includes(phone.status)) return { role: 'phone', phone };
    }
    throw fail(403, 'This device does not have access to this session.');
  }
  const access = (ownerOnly = false, approved = true) => (req, res, next) => {
    try {
      req.capture = getSession(req); req.identity = identity(req, req.capture, ownerOnly);
      if (approved && req.identity.role === 'phone' && req.identity.phone.status !== 'approved') throw fail(403, 'Wait for approval on the desktop.');
      next();
    } catch (e) { next(e); }
  };
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return next(fail(403, 'Request origin is not allowed.'));
    next();
  });
  app.get('/api/bootstrap', (req, res) => {
    const existing = cookies(req).rs_owner;
    res.setHeader('Set-Cookie', serialize('rs_owner', /^[a-f0-9]{64}$/.test(existing || '') ? existing : token(), { ...cookieOptions, maxAge: 86400 }));
    res.json({ origin, phoneReady: secure, inferenceConfigured: Boolean(workerUrl), limits: LIMITS });
  });
  app.post('/api/sessions', async (req, res) => {
    sweep(); rateLimit(req, 'session', 10);
    const owner = cookies(req).rs_owner;
    if (!/^[a-f0-9]{64}$/.test(owner || '')) throw fail(401, 'Reload the editor to initialize your session.');
    if (sessions.size >= 100) throw fail(503, 'Capture service is busy. Try again later.');
    for (const s of sessions.values()) if (s.owner === hash(owner)) destroy(s);
    const invitation = token();
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while ([...sessions.values()].some(s => s.code === code));
    const s = { id: token().slice(0, 24), owner: hash(owner), invitation: hash(invitation), code, inviteExpiresAt: now() + inviteMs, expiresAt: now() + lifetimeMs, phones: new Map(), photos: new Map(), job: null, asset: null };
    sessions.set(s.id, s);
    // Fragment credentials are never sent in HTTP URLs, logs, or referrers.
    const url = `${origin}/capture#${invitation}`;
    res.status(201).json({ ...snapshot(s, 'owner'), url, code: `${code.slice(0, 4)} ${code.slice(4)}`, qr: await QRCode.toDataURL(url, { margin: 2, width: 280, color: { dark: '#1b332c', light: '#ffffff' } }) });
  });
  app.post('/api/pair', (req, res) => {
    rateLimit(req, 'pair', 12);
    const { invitation, code, name } = req.body || {};
    const s = [...sessions.values()].find(s => s.inviteExpiresAt > now() && s.expiresAt > now() && (typeof invitation === 'string' && hash(invitation) === s.invitation || typeof code === 'string' && code.toUpperCase().replace(/\s/g, '') === s.code));
    if (!s || !s.invitation) throw fail(404, 'Pairing code is invalid, expired, or already used. Create a new session on the desktop.');
    if (s.phones.size >= 4) throw fail(429, 'Too many pairing requests. Create a new session.');
    const secret = token();
    const phone = { id: token().slice(0, 16), secret: hash(secret), name: String(name || 'Phone').slice(0, 40), status: 'pending', verification: String(randomInt(100000, 999999)) };
    s.phones.set(phone.id, phone);
    res.setHeader('Set-Cookie', serialize('rs_phone', secret, cookieOptions));
    emit(s); res.status(201).json(snapshot(s, 'phone', phone));
  });
  app.get('/api/sessions/:id', access(false, false), (req, res) => res.json(snapshot(req.capture, req.identity.role, req.identity.phone)));
  app.post('/api/sessions/:id/phones/:phone/approve', access(true), (req, res) => {
    const s = req.capture; const phone = s.phones.get(req.params.phone);
    if (!phone || phone.status !== 'pending') throw fail(404, 'Pairing request no longer exists.');
    phone.status = 'approved'; s.invitation = null; s.code = null;
    for (const other of s.phones.values()) if (other !== phone) other.status = 'rejected';
    emit(s);
    for (const ws of wss.clients) if (ws.session === s && ws.phone && ws.phone !== phone) ws.close(4003, 'Another phone was approved');
    res.json({ ok: true });
  });
  app.delete('/api/sessions/:id/phones/:phone', access(true), (req, res) => {
    const s = req.capture; const phone = s.phones.get(req.params.phone);
    if (!phone) throw fail(404, 'Phone not found.');
    phone.status = 'disconnected'; emit(s);
    for (const ws of wss.clients) if (ws.session === s && ws.phone === phone) ws.close(4003, 'Disconnected by desktop');
    res.json({ ok: true });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.photoBytes, files: 1, fields: 1, fieldSize: 100 }, fileFilter(req, file, done) { done(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)); } }).single('photo');
  app.post('/api/sessions/:id/photos', access(), (req, res, next) => {
    try {
      rateLimit(req, 'upload', 36);
      if (activeUploads >= 4 || bytes >= LIMITS.totalBytes - LIMITS.photoBytes) throw fail(503, 'Capture storage is busy. Delete captures and try again.');
      activeUploads++;
      upload(req, res, async err => {
        try {
          if (err) throw err;
          if (!req.file) throw fail(415, 'Choose a JPEG, PNG, or WebP photograph (up to 8 MB).');
          if (!['furniture', 'room'].includes(req.body.mode)) throw fail(400, 'Choose furniture or room capture mode.');
          const s = req.capture;
          const decoded = sharp(req.file.buffer, { limitInputPixels: 24_000_000, failOn: 'error' });
          const meta = await decoded.metadata();
          if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw fail(415, 'The file must contain a single JPEG, PNG, or WebP image.');
          const { data, info } = await decoded.rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
          // Recheck after asynchronous decoding: expiry, revocation and quota can change.
          getSession(req); identity(req, s);
          if (req.identity.phone && req.identity.phone.status !== 'approved') throw fail(403, 'Phone approval was revoked.');
          if (s.photos.size >= LIMITS.photos || bytes + data.length > LIMITS.totalBytes) throw fail(413, 'Capture storage is full. Delete some photos first.');
          const p = { id: token().slice(0, 20), mode: req.body.mode, data, width: info.width, height: info.height, createdAt: now() };
          s.photos.set(p.id, p); bytes += data.length; emit(s);
          res.status(201).json({ id: p.id });
        } catch (e) { next(e.status || e.code === 'LIMIT_FILE_SIZE' ? e : fail(415, 'Unable to decode this image. Use a valid JPEG, PNG, or WebP under 24 megapixels.')); }
        finally { activeUploads--; }
      });
    } catch (e) { next(e); }
  });
  app.get('/api/sessions/:id/photos/:photo', access(), (req, res) => {
    const p = req.capture.photos.get(req.params.photo);
    if (!p) throw fail(404, 'Photo was deleted or expired.');
    res.type('image/jpeg').send(p.data);
  });
  app.delete('/api/sessions/:id/photos/:photo', access(), (req, res) => {
    const s = req.capture;
    if (s.job?.photoId === req.params.photo && s.job.status === 'running') { s.controller?.abort(); s.job = { ...s.job, status: 'failed', message: 'Reconstruction cancelled because the source photo was deleted.' }; }
    dropPhoto(s, req.params.photo); emit(s); res.json({ ok: true });
  });
  app.delete('/api/sessions/:id', access(true), (req, res) => { destroy(req.capture); res.json({ ok: true }); });

  app.post('/api/sessions/:id/reconstruct', access(true), async (req, res) => {
    const s = req.capture; rateLimit(req, 'reconstruct', 6);
    if ([...sessions.values()].filter(s => s.job?.status === 'running').length >= 2) throw fail(409, 'The reconstruction worker is busy. Try again when the current job finishes.');
    if (s.job?.status === 'running') throw fail(409, 'A reconstruction is already running.');
    const p = s.photos.get(req.body.photoId);
    if (!p || p.mode !== 'furniture') throw fail(400, 'Select a furniture photo first.');
    const polygon = req.body.polygon;
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 128 || polygon.some(point => !Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw fail(400, 'Outline the furniture with at least three points.');
    const area = Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    if (area < 0.001) throw fail(400, 'The mask is too small. Outline the furniture.');
    const job = { id: token().slice(0, 16), photoId: p.id, status: 'running', stage: 'Preparing image and mask', startedAt: now(), source: 'sam3d' };
    s.job = job; s.controller = new AbortController();
    res.status(202).json(job); emit(s);
    try {
      if (!workerUrl) throw new Error('SAM 3D Objects is unavailable: no inference worker is configured. Your photo has not been reconstructed. You can retry later or explicitly import a demo chair.');
      const svg = `<svg width="${p.width}" height="${p.height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="black"/><polygon points="${polygon.map(([x, y]) => `${x * p.width},${y * p.height}`).join(' ')}" fill="white"/></svg>`;
      const mask = await sharp(Buffer.from(svg)).png().toBuffer();
      const body = new FormData(); body.append('image', new Blob([p.data], { type: 'image/jpeg' }), 'image.jpg'); body.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
      job.stage = 'Reconstructing with SAM 3D Objects'; emit(s);
      const response = await fetch(workerUrl, { method: 'POST', body, headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : {}, redirect: 'error', signal: AbortSignal.any([s.controller.signal, AbortSignal.timeout(10 * 60_000)]) });
      if (!response.ok) throw new Error(`Inference worker returned HTTP ${response.status}. No asset was imported.`);
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > LIMITS.assetBytes) { s.controller.abort(); throw new Error('Inference asset exceeded the 32 MB limit.'); } chunks.push(chunk); }
      const asset = Buffer.concat(chunks); validateGLB(asset);
      if (!sessions.has(s.id) || s.job !== job || job.status !== 'running') return;
      if (bytes + asset.length - (s.asset?.length || 0) > LIMITS.totalBytes) throw new Error('Capture storage is full. Delete captures and retry.');
      if (s.asset) bytes -= s.asset.length;
      s.asset = asset; bytes += asset.length;
      job.status = 'succeeded'; job.stage = 'Ready to preview and confirm scale'; job.assetUrl = `/api/sessions/${s.id}/asset/${job.id}`;
      // Reconstruction no longer needs the private source image.
      dropPhoto(s, p.id); emit(s);
    } catch (e) {
      if (sessions.has(s.id) && s.job === job && job.status === 'running') { job.status = 'failed'; job.message = e.name === 'TimeoutError' ? 'Reconstruction timed out after 10 minutes. Try again.' : e.name === 'AbortError' ? 'Reconstruction was cancelled.' : e.message; emit(s); }
    }
  });
  app.get('/api/sessions/:id/asset/:job', access(true), (req, res) => {
    const s = req.capture;
    if (s.job?.id !== req.params.job || s.job.status !== 'succeeded' || !s.asset) throw fail(404, 'Asset unavailable.');
    res.type('model/gltf-binary').send(s.asset);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws?')) return; // Vite handles its own HMR upgrade.
    try {
      if (req.headers.origin !== origin) throw fail(403, 'Invalid WebSocket origin');
      req.params = { id: new URL(req.url, origin).searchParams.get('session') };
      const s = getSession(req); const who = identity(req, s);
      if ([...wss.clients].filter(ws => ws.session === s).length >= 12) throw fail(429, 'Too many connections');
      wss.handleUpgrade(req, socket, head, ws => {
        ws.session = s; ws.role = who.role; ws.phone = who.phone; ws.alive = true;
        ws.on('error', () => {}); ws.on('pong', () => { ws.alive = true; });
        ws.send(JSON.stringify({ type: 'snapshot', ...snapshot(s, who.role, who.phone) }));
        wss.emit('connection', ws, req);
      });
    } catch { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); }
  });
  const cleanup = setInterval(() => { sweep(); for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 20_000);
  cleanup.unref();
  return { sessions, sweep, get bytes() { return bytes; }, close() { clearInterval(cleanup); for (const s of sessions.values()) destroy(s); for (const ws of wss.clients) ws.terminate(); wss.close(); } };
}
