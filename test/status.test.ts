import { describe, expect, it } from 'vitest';
import { lifecycleFor, shouldFail } from '../src/status.js';
import type { ModelDefinition, ScanReport } from '../src/types.js';

const model: ModelDefinition = {
  id: 'old-model',
  provider: 'test',
  shutdownAt: '2026-10-20',
  replacement: 'new-model',
};

function report(state: 'deprecated' | 'critical' | 'retired'): ScanReport {
  return {
    root: '/tmp',
    generatedAt: '2026-07-22T00:00:00.000Z',
    registryUpdatedAt: '2026-07-22',
    stats: { filesConsidered: 1, filesScanned: 1, filesSkipped: 0, bytesScanned: 10 },
    findings: [
      {
        file: 'a.ts',
        absolutePath: '/tmp/a.ts',
        line: 1,
        column: 1,
        offset: 0,
        length: 9,
        matchedId: 'old-model',
        model: { ...model, state, daysUntilShutdown: state === 'retired' ? 0 : 20 },
      },
    ],
  };
}

describe('lifecycle status', () => {
  it('distinguishes deprecated, critical, and retired dates', () => {
    expect(lifecycleFor(model, new Date('2026-01-01T12:00:00Z'), 90).state).toBe('deprecated');
    expect(lifecycleFor(model, new Date('2026-09-20T12:00:00Z'), 90).state).toBe('critical');
    expect(lifecycleFor(model, new Date('2026-10-20T00:00:00Z'), 90).state).toBe('retired');
  });

  it('applies failure thresholds', () => {
    expect(shouldFail(report('deprecated'), 'deprecated')).toBe(true);
    expect(shouldFail(report('deprecated'), 'retired')).toBe(false);
    expect(shouldFail(report('retired'), 'retired')).toBe(true);
    expect(shouldFail(report('retired'), 'never')).toBe(false);
  });
});
