// Own the test server in this process so Windows need not kill a nested shell tree.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.js';
const runtime = await createApp({ production: true, origin: 'http://localhost:3000', workerUrl: '' });
await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(3000, '127.0.0.1', resolve); });
try {
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ROOMSHIFT_TEST_SERVER: '1' } });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { await runtime.close(); }
