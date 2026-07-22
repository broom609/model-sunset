import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findModel, loadBundledRegistry, loadRegistry, validateRegistry } from '../src/registry.js';

afterEach(() => vi.unstubAllGlobals());

describe('registry', () => {
  it('loads a substantial, valid, multi-provider registry', () => {
    const registry = loadBundledRegistry();
    expect(registry.models.length).toBeGreaterThan(50);
    expect(Object.keys(registry.providers).sort()).toEqual(['anthropic', 'google', 'openai']);
    expect(findModel(registry, 'gpt-4')?.replacement).toBe('gpt-5.5');
    expect(findModel(registry, 'claude-opus-4-1-20250805')?.replacement).toBe('claude-opus-4-8');
    expect(findModel(registry, 'gemini-embedding-001')?.replacement).toBe('gemini-embedding-2');
  });

  it('rejects duplicate aliases', () => {
    expect(() =>
      validateRegistry({
        schemaVersion: 1,
        updatedAt: '2026-07-22',
        providers: { test: { name: 'Test', source: 'https://example.com' } },
        models: [
          { id: 'old-a', aliases: ['collision'], provider: 'test', shutdownAt: '2027-01-01' },
          { id: 'old-b', aliases: ['collision'], provider: 'test', shutdownAt: '2027-01-01' },
        ],
      }),
    ).toThrow(/Duplicate model identifier/);
  });

  it('rejects unknown providers and inverted dates', () => {
    expect(() =>
      validateRegistry({
        schemaVersion: 1,
        updatedAt: '2026-07-22',
        providers: { test: { name: 'Test', source: 'https://example.com' } },
        models: [{ id: 'old', provider: 'missing', shutdownAt: '2027-01-01' }],
      }),
    ).toThrow(/Unknown provider/);
    expect(() =>
      validateRegistry({
        schemaVersion: 1,
        updatedAt: '2026-07-22',
        providers: { test: { name: 'Test', source: 'https://example.com' } },
        models: [{ id: 'old', provider: 'test', deprecatedAt: '2027-02-01', shutdownAt: '2027-01-01' }],
      }),
    ).toThrow(/after shutdown/);
  });

  it('loads validated local and HTTPS custom registries', async () => {
    const custom = {
      schemaVersion: 1,
      updatedAt: '2026-07-22',
      providers: { test: { name: 'Test', source: 'https://example.com' } },
      models: [{ id: 'old', provider: 'test', shutdownAt: '2027-01-01', replacement: 'new' }],
    };
    const root = await mkdtemp(join(tmpdir(), 'modelsunset-registry-'));
    await writeFile(join(root, 'registry.json'), JSON.stringify(custom));
    expect((await loadRegistry('registry.json', root)).models[0]?.id).toBe('old');

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(custom), { status: 200 }))));
    expect((await loadRegistry('https://example.com/registry.json')).models[0]?.replacement).toBe('new');
  });

  it('rejects insecure and failed remote registries', async () => {
    await expect(loadRegistry('http://example.com/registry.json')).rejects.toThrow(/HTTPS/);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))));
    await expect(loadRegistry('https://example.com/registry.json')).rejects.toThrow(/503/);
  });

  it('rejects a replacement that points to its own alias', () => {
    expect(() =>
      validateRegistry({
        schemaVersion: 1,
        updatedAt: '2026-07-22',
        providers: { test: { name: 'Test', source: 'https://example.com' } },
        models: [{ id: 'old', aliases: ['old-alias'], provider: 'test', shutdownAt: '2027-01-01', replacement: 'old-alias' }],
      }),
    ).toThrow(/points back/);
  });
});
