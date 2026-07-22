import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { applyMigrations } from '../src/migrate.js';
import { loadBundledRegistry } from '../src/registry.js';
import { scanPath } from '../src/scanner.js';

describe('safe migrations', () => {
  it('supports dry runs and descending-offset replacements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-migrate-'));
    const file = join(root, 'models.ts');
    const original = 'export const models = ["gpt-4", "gpt-3.5-turbo"];\n';
    await writeFile(file, original);
    const report = await scanPath({ root, registry: loadBundledRegistry(), config: { ...defaultConfig } });
    const dry = await applyMigrations(report, true);
    expect(dry).toMatchObject({ changedFiles: ['models.ts'], replacements: 2 });
    expect(await readFile(file, 'utf8')).toBe(original);
    await applyMigrations(report, false);
    expect(await readFile(file, 'utf8')).toBe('export const models = ["gpt-5.5", "gpt-5.4-mini"];\n');
  });

  it('reports models without a direct replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-migrate-'));
    await writeFile(join(root, 'video.ts'), 'const model = "sora-2";\n');
    const report = await scanPath({ root, registry: loadBundledRegistry(), config: { ...defaultConfig } });
    expect(await applyMigrations(report, true)).toMatchObject({
      changedFiles: [],
      replacements: 0,
      skippedWithoutReplacement: 1,
    });
  });

  it('refuses to migrate a file changed after scanning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-migrate-'));
    const file = join(root, 'model.ts');
    await writeFile(file, 'const model = "gpt-4";\n');
    const report = await scanPath({ root, registry: loadBundledRegistry(), config: { ...defaultConfig } });
    await writeFile(file, 'const model = "o1";\n');
    await expect(applyMigrations(report, false)).rejects.toThrow(/changed after scan/);
  });
});
