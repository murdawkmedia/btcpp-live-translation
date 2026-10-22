import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const folder of ['src', 'public', 'scripts', 'test']) {
  for (const file of await readdir(new URL(`../${folder}/`, import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${folder}/${file}`], { encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
    count++;
  }
}
console.log(`Syntax checked ${count} JavaScript files.`);
