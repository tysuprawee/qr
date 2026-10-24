import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { fixtureGLB } from './fixtures.js';
import { validateGLB } from '../server/capture.js';

const origin = 'http://localhost:3000';
async function setup(t, options = {}) {
  const runtime = await createApp({ origin, frontend: false, ...options });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  t.after(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  async function req(route, method = 'GET', body, cookie = '', extraHeaders = {}) {
    const response = await fetch(`${base}/api${route}`, { method, headers: { Origin: origin, Cookie: cookie, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  const owner = (await req('/bootstrap')).cookie;
  const s = (await req('/sessions', 'POST', {}, owner)).data;
  async function pair() { const result = await req('/pair', 'POST', { code: s.code, name: 'Test iPhone' }); return { ...result, id: result.data.phone?.id }; }
  async function photo(cookie, buffer, type = 'image/jpeg', mode = 'furniture') { const form = new FormData(); form.append('mode', mode); form.append('photo', new Blob([buffer || await sharp({ create: { width: 120, height: 160, channels: 3, background: '#82916a' } }).jpeg().toBuffer()], { type }), 'chair.jpg'); return req(`/sessions/${s.id}/photos`, 'POST', form, cookie); }
  async function approve(phone) { return req(`/sessions/${s.id}/phones/${phone.id}/approve`, 'POST', {}, owner); }
  function socket(cookie, requestOrigin = origin) { return new WebSocket(`${base.replace('http:', 'ws:')}/ws?session=${s.id}`, { headers: { Cookie: cookie, Origin: requestOrigin } }); }
  return { runtime, base, req, owner, s, pair, approve, photo, socket };
}
function message(ws, predicate = () => true) { return new Promise((resolve, reject) => { const timeout = setTimeout(() => { ws.off('message', onMessage); reject(new Error('WebSocket event timed out')); }, 4000); const onMessage = raw => { const data = JSON.parse(raw); if (predicate(data)) { clearTimeout(timeout); ws.off('message', onMessage); resolve(data); } }; ws.on('message', onMessage); ws.once('error', reject); }); }

test('pairing requires desktop approval, streams uploads, strips metadata and revokes phone access', async t => {
  const f = await setup(t); const phone = await f.pair();
  assert.equal(phone.status, 201); assert.equal(phone.data.phone.status, 'pending');
  assert.equal((await f.photo(phone.cookie)).status, 403);
  assert.equal((await f.req(`/sessions/${f.s.id}/phones/${phone.id}/approve`, 'POST', {}, phone.cookie)).status, 403);
  const ws = f.socket(f.owner); await message(ws); t.after(() => ws.terminate());
  const approved = message(ws, data => data.phones?.some(p => p.status === 'approved'));
  assert.equal((await f.approve(phone)).status, 200); await approved;
  const event = message(ws, data => data.captures?.length === 1);
  const photo = await f.photo(phone.cookie); assert.equal(photo.status, 201);
  const state = await event; assert.equal(state.captures[0].id, photo.data.id);
  const image = await f.req(`/sessions/${f.s.id}/photos/${photo.data.id}`, 'GET', undefined, f.owner);
  assert.equal(image.status, 200); assert.equal(image.headers.get('cache-control'), 'no-store');
  const metadata = await sharp(image.data).metadata(); assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.exif, undefined);
  assert.equal((await f.req(`/sessions/${f.s.id}/photos/${photo.data.id}`)).status, 403);
  assert.equal((await f.req('/pair', 'POST', { code: f.s.code })).status, 404);
  await f.req(`/sessions/${f.s.id}/phones/${phone.id}`, 'DELETE', {}, f.owner);
  assert.equal((await f.photo(phone.cookie)).status, 403);
  assert.equal((await f.req(`/sessions/${f.s.id}`, 'GET', undefined, phone.cookie)).status, 403);
});

test('QR contains only a temporary fragment invitation and human code is rate limited', async t => {
  const f = await setup(t); const url = new URL(f.s.url);
  assert.equal(url.pathname, '/capture'); assert.equal(url.search, ''); assert.equal(url.hash.length, 65);
  assert.ok(!JSON.stringify(f.s).includes(f.owner.split('=')[1]));
  assert.match(f.s.qr, /^data:image\/png;base64,/);
  for (let i = 0; i < 12; i++) assert.equal((await f.req('/pair', 'POST', { code: 'BADCODE' })).status, 404);
  assert.equal((await f.req('/pair', 'POST', { code: 'BADCODE' })).status, 429);
});

test('spoofed images, large uploads, invalid masks and cross-origin mutation are rejected', async t => {
  const f = await setup(t); const phone = await f.pair(); await f.approve(phone);
  assert.equal((await f.photo(phone.cookie, Buffer.from('<svg onload="evil"/>'))).status, 415);
  assert.equal((await f.photo(phone.cookie, Buffer.alloc(8 * 1024 ** 2 + 1))).status, 413);
  assert.equal((await f.photo(phone.cookie, Buffer.from('hello'), 'image/svg+xml')).status, 415);
  assert.equal((await f.req('/sessions', 'POST', {}, f.owner, { Origin: 'https://attacker.example' })).status, 403);
  const photo = await f.photo(phone.cookie);
  assert.equal((await f.req(`/sessions/${f.s.id}/reconstruct`, 'POST', { photoId: photo.data.id, polygon: [[0, 0], [2, 0], [0, 1]] }, f.owner)).status, 400);
  const ws = f.socket(f.owner, 'https://attacker.example');
  const error = await new Promise(resolve => ws.once('error', resolve)); assert.match(error.message, /403/);
});

test('unconfigured inference returns a real failed job without a synthetic asset', async t => {
  const f = await setup(t); const phone = await f.pair(); await f.approve(phone); const photo = await f.photo(phone.cookie);
  const result = await f.req(`/sessions/${f.s.id}/reconstruct`, 'POST', { photoId: photo.data.id, polygon: [[.1, .1], [.9, .1], [.9, .9], [.1, .9]] }, f.owner);
  assert.equal(result.status, 202);
  const state = await f.req(`/sessions/${f.s.id}`, 'GET', undefined, f.owner);
  assert.equal(state.data.job.status, 'failed'); assert.match(state.data.job.message, /no inference worker/); assert.equal(state.data.job.assetUrl, undefined); assert.equal(state.data.captures.length, 1);
});

test('successful worker transport receives matching image/mask, delivers GLB, purges source photo', async t => {
  let received;
  const worker = http.createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); received = { headers: req.headers, data: Buffer.concat(chunks).toString('latin1') }; res.setHeader('Content-Type', 'model/gltf-binary'); res.end(fixtureGLB()); });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => worker.close(resolve)));
  const f = await setup(t, { workerUrl: `http://127.0.0.1:${worker.address().port}/reconstruct`, workerToken: 'test-server-only-secret' });
  const phone = await f.pair(); await f.approve(phone); const photo = await f.photo(phone.cookie);
  const ws = f.socket(f.owner); await message(ws); t.after(() => ws.terminate());
  const ready = message(ws, data => data.job?.status === 'succeeded');
  await f.req(`/sessions/${f.s.id}/reconstruct`, 'POST', { photoId: photo.data.id, polygon: [[.1, .1], [.9, .1], [.9, .9], [.1, .9]] }, f.owner);
  const state = await ready; assert.equal(state.captures.length, 0); assert.equal(state.job.source, 'sam3d');
  assert.match(received.data, /name="image"/); assert.match(received.data, /name="mask"/); assert.equal(received.headers.authorization, 'Bearer test-server-only-secret');
  const result = await f.req(state.job.assetUrl.replace('/api', ''), 'GET', undefined, f.owner); assert.equal(result.status, 200); validateGLB(result.data);
  assert.equal((await f.req(state.job.assetUrl.replace('/api', ''), 'GET', undefined, phone.cookie)).status, 403);
});

test('expiry and deletion purge image buffers and reject session access', async t => {
  let now = Date.now(); const f = await setup(t, { now: () => now });
  const phone = await f.pair(); await f.approve(phone); const photo = await f.photo(phone.cookie);
  assert.ok(f.runtime.capture.bytes > 0);
  now += 31 * 60_000; f.runtime.capture.sweep(); assert.equal(f.runtime.capture.bytes, 0);
  assert.equal((await f.req(`/sessions/${f.s.id}/photos/${photo.data.id}`, 'GET', undefined, f.owner)).status, 404);
  await f.photo(phone.cookie); assert.ok(f.runtime.capture.bytes > 0);
  now += 31 * 60_000; f.runtime.capture.sweep(); assert.equal(f.runtime.capture.bytes, 0);
  assert.equal((await f.req(`/sessions/${f.s.id}`, 'GET', undefined, f.owner)).status, 410);
});

test('invitation expires independently of the capture session', async t => {
  let now = Date.now(); const f = await setup(t, { now: () => now }); now += 11 * 60_000;
  assert.equal((await f.pair()).status, 404); assert.equal((await f.req(`/sessions/${f.s.id}`, 'GET', undefined, f.owner)).status, 200);
});

test('second phone cannot reuse invitation after approval and session ending deletes all captures', async t => {
  const f = await setup(t); const first = await f.pair(); const second = await f.pair(); await f.approve(first);
  assert.equal((await f.req(`/sessions/${f.s.id}`, 'GET', undefined, second.cookie)).status, 403);
  await f.photo(first.cookie); assert.ok(f.runtime.capture.bytes > 0);
  assert.equal((await f.req(`/sessions/${f.s.id}`, 'DELETE', {}, f.owner)).status, 200);
  assert.equal(f.runtime.capture.bytes, 0); assert.equal(f.runtime.capture.sessions.size, 0);
});
