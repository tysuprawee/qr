import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCapture } from './capture.js';

export async function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  const origin = options.origin || process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
  const production = options.production ?? process.env.NODE_ENV === 'production';
  if (new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN must be an origin with no path or trailing slash.');
  if (new URL(origin).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Phone access requires an HTTPS PUBLIC_ORIGIN.');
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()' });
    if (origin.startsWith('https:')) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (production) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const tls = process.env.TLS_CERT && process.env.TLS_KEY;
  const server = tls ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, app) : http.createServer(app);
  server.requestTimeout = 45_000;
  const capture = installCapture(app, server, { ...options, origin, workerUrl: options.workerUrl ?? process.env.SAM_WORKER_URL, workerToken: options.workerToken ?? process.env.SAM_WORKER_TOKEN });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || (err.name === 'MulterError' ? 400 : 500);
    res.status(status).json({ error: status === 500 ? 'The capture service encountered an error. Please retry.' : err.code === 'LIMIT_FILE_SIZE' ? 'Photo exceeds the 8 MB upload limit.' : err.message });
  });
  let vite;
  if (options.frontend !== false) {
    if (production) {
      app.use(express.static(path.resolve('dist'), { index: false }));
      app.get('/{*path}', (req, res) => res.sendFile(path.resolve('dist/index.html')));
    } else {
      const { createServer } = await import('vite');
      vite = await createServer({ configLoader: 'native', server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
      app.use(vite.middlewares);
    }
  }
  return { app, server, capture, async close() { capture.close(); await vite?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const runtime = await createApp();
  const port = Number(process.env.PORT || 3000);
  runtime.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`RoomShift listening on ${process.env.PUBLIC_ORIGIN || `http://localhost:${port}`}\nPhone capture requires a trusted HTTPS origin. See README.md.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await runtime.close(); process.exit(0); });
}
