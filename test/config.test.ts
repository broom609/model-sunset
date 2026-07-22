import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, findConfig, loadConfig } from '../src/config.js';

describe('configuration', () => {
  it('returns safe defaults without a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-config-'));
    expect(findConfig(root)).toBeUndefined();
    expect(loadConfig(root)).toEqual(defaultConfig);
  });

  it('loads JSON and appends default excludes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-config-'));
    await writeFile(
      join(root, '.modelsunset.json'),
      JSON.stringify({ daysBeforeShutdown: 30, exclude: ['generated/**'], failOn: 'retired' }),
    );
    const config = loadConfig(root);
    expect(config.daysBeforeShutdown).toBe(30);
    expect(config.failOn).toBe('retired');
    expect(config.exclude).toContain('generated/**');
    expect(config.exclude).toContain('**/node_modules/**');
  });

  it('loads YAML and rejects invalid settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-config-'));
    await writeFile(join(root, 'custom.yml'), 'ignoreModels:\n  - gpt-4\nmaxFileBytes: 1000\n');
    expect(loadConfig(root, 'custom.yml').ignoreModels).toEqual(['gpt-4']);
    await writeFile(join(root, 'bad.json'), JSON.stringify({ failOn: 'sometimes' }));
    expect(() => loadConfig(root, 'bad.json')).toThrow();
    expect(() => loadConfig(root, 'missing.json')).toThrow(/not found/);
  });
});
