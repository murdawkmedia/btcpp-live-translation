import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createApp } from './server.js';
import { configFromEnv } from './config.js';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true, mode: 0o700 });
async function capability(name, supplied) {
  if (supplied) return supplied;
  const path = new URL(`../.runtime/${name}`, import.meta.url);
  try { return (await readFile(path, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const value = randomBytes(32).toString('hex');
    await writeFile(path, value, { mode: 0o600, flag: 'wx' }); return value;
  }
}
const app = createApp({ ...configFromEnv(process.env), operatorToken: await capability('operator-token', process.env.OPERATOR_TOKEN),
  viewerToken: await capability('viewer-token', process.env.VIEWER_TOKEN),
  publicBaseUrl: process.env.PUBLIC_BASE_URL });
const port = Number(process.env.PORT || 4317);
app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(JSON.stringify({ service: 'btcpp-live-translation', port, operatorTokenFile: '.runtime/operator-token',
    message: 'Open the operator page. Enter the local operator token privately. Rehearsal uses sample captions and a test tone.' }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
