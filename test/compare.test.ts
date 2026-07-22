import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareModels } from '../src/compare.js';

describe('model comparison harness', () => {
  it('compares output shape, latency, and cost through a project-owned adapter', async () => {
    const results = await compareModels({
      model: 'old-model',
      replacement: 'new-model',
      fixturesPath: resolve('test/fixtures/compare.json'),
      command: 'node test/fixtures/adapter.mjs',
      maxLatencyRegressionPercent: 10_000,
      maxCostRegressionPercent: 25,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ fixture: 'support ticket', shapeCompatible: true, passed: true });
    expect(results[0]?.costRegressionPercent).toBeCloseTo(10);
  });

  it('returns a failed result instead of throwing when the adapter fails', async () => {
    const results = await compareModels({
      model: 'old-model',
      replacement: 'new-model',
      fixturesPath: resolve('test/fixtures/compare.json'),
      command: 'node -e "process.exit(7)"',
    });
    expect(results[0]).toMatchObject({ passed: false, shapeCompatible: false });
    expect(results[0]?.error).toMatch(/exited 7/);
  });
});
