import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const action = resolve('dist/action/index.js');
await access(cli);
await access(action);

const actionStats = await stat(action);
if (actionStats.size < 100_000) throw new Error(`Action bundle is unexpectedly small: ${actionStats.size} bytes`);
const actionContents = await readFile(action, 'utf8');
if (!actionContents.includes('ModelSunset')) throw new Error('Action bundle does not contain ModelSunset runtime');

const project = await mkdtemp(join(tmpdir(), 'modelsunset-dist-'));
await writeFile(join(project, 'app.ts'), 'export const model = "gpt-4";\n', 'utf8');
const scan = spawnSync(
  process.execPath,
  [cli, 'scan', project, '--format', 'json', '--fail-on', 'never', '--at', '2026-07-22'],
  { encoding: 'utf8' },
);
if (scan.status !== 0) throw new Error(`Built CLI scan failed: ${scan.stderr}`);
const report = JSON.parse(scan.stdout);
if (report.findings?.length !== 1 || report.findings[0]?.matchedId !== 'gpt-4') {
  throw new Error(`Built CLI returned unexpected findings: ${scan.stdout}`);
}

const fix = spawnSync(process.execPath, [cli, 'fix', project, '--yes', '--fail-on', 'never'], { encoding: 'utf8' });
if (fix.status !== 0) throw new Error(`Built CLI fix failed: ${fix.stderr}`);
if (!(await readFile(join(project, 'app.ts'), 'utf8')).includes('gpt-5.5')) {
  throw new Error('Built CLI did not apply the expected migration');
}

const check = spawnSync(process.execPath, [cli, 'check', 'gpt-4', '--at', '2026-07-22'], { encoding: 'utf8' });
if (check.status !== 1 || !check.stdout.includes('gpt-5.5')) throw new Error('Built CLI check contract failed');

process.stdout.write('Distribution verified: bundled action and CLI scan/fix/check contracts passed.\n');
