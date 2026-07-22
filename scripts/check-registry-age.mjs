import { readFile } from 'node:fs/promises';

const registry = JSON.parse(await readFile(new URL('../registry/models.json', import.meta.url), 'utf8'));
const maxDays = Number(process.argv[2] ?? 45);
if (!Number.isInteger(maxDays) || maxDays < 1) throw new Error(`Invalid maximum age: ${maxDays}`);
const updated = Date.parse(`${registry.updatedAt}T00:00:00.000Z`);
if (Number.isNaN(updated)) throw new Error(`Invalid registry updatedAt: ${registry.updatedAt}`);
const age = Math.floor((Date.now() - updated) / 86_400_000);
if (age > maxDays) {
  process.stderr.write(`Registry is ${age} days old; maximum allowed age is ${maxDays}.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Registry age is ${age} day(s); freshness limit is ${maxDays}.\n`);
}
