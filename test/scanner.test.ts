import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import { loadBundledRegistry } from '../src/registry.js';
import { scanPath } from '../src/scanner.js';

describe('scanner', () => {
  it('finds exact identifiers with source positions and ignores embedded substrings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-scan-'));
    await writeFile(join(root, 'app.ts'), 'const one = "gpt-4";\nconst two = "claude-opus-4-1-20250805";\nconst safe = "xgpt-4-turbo";\n');
    const report = await scanPath({
      root,
      registry: loadBundledRegistry(),
      config: { ...defaultConfig },
      at: new Date('2026-07-22T12:00:00Z'),
    });
    expect(report.findings.map((finding) => finding.matchedId).sort()).toEqual([
      'claude-opus-4-1-20250805',
      'gpt-4',
    ]);
    expect(report.findings.find((finding) => finding.matchedId === 'gpt-4')).toMatchObject({ line: 1, column: 14 });
  });

  it('honors ignores, skips binary and oversized files, and excludes dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-scan-'));
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'hidden.js'), 'const model = "gpt-4";');
    await writeFile(join(root, 'ignored.ts'), 'const model = "gpt-4";');
    await writeFile(join(root, 'binary.ts'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, 'large.ts'), 'gpt-4'.repeat(100));
    const report = await scanPath({
      root,
      registry: loadBundledRegistry(),
      config: { ...defaultConfig, ignoreModels: ['gpt-4'], maxFileBytes: 100 },
    });
    expect(report.findings).toHaveLength(0);
    expect(report.stats.filesSkipped).toBe(2);
    expect(report.stats.filesConsidered).toBe(3);
  });

  it('scans a single file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-scan-'));
    const file = join(root, 'model.py');
    await writeFile(file, 'MODEL = "gemini-embedding-001"\n');
    const report = await scanPath({ root: file, registry: loadBundledRegistry(), config: { ...defaultConfig } });
    expect(report.findings[0]).toMatchObject({ file: 'model.py', matchedId: 'gemini-embedding-001' });
  });
});
