import { describe, expect, it } from 'vitest';
import { markdownReport, sarifReport, tableReport } from '../src/reporters/index.js';
import type { ScanReport } from '../src/types.js';

const report: ScanReport = {
  root: '/repo',
  generatedAt: '2026-07-22T00:00:00.000Z',
  registryUpdatedAt: '2026-07-22',
  stats: { filesConsidered: 1, filesScanned: 1, filesSkipped: 0, bytesScanned: 20 },
  findings: [
    {
      file: 'src/app.ts',
      absolutePath: '/repo/src/app.ts',
      line: 4,
      column: 12,
      offset: 30,
      length: 5,
      matchedId: 'gpt-4',
      model: {
        id: 'gpt-4-0613',
        provider: 'openai',
        shutdownAt: '2026-10-23',
        replacement: 'gpt-5.5',
        state: 'critical',
        daysUntilShutdown: 90,
      },
    },
  ],
};

describe('reporters', () => {
  it('renders human-readable table and markdown output', () => {
    expect(tableReport(report, false)).toContain('CRITICAL');
    expect(tableReport(report, false)).toContain('src/app.ts:4:12');
    expect(markdownReport(report)).toContain('| critical | openai | `gpt-4` |');
  });

  it('renders valid SARIF with source location and properties', () => {
    const sarif = sarifReport(report) as { version: string; runs: Array<{ results: unknown[] }> };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results).toHaveLength(1);
    expect(JSON.stringify(sarif)).toContain('src/app.ts');
  });

  it('renders a clean report', () => {
    const clean = { ...report, findings: [] };
    expect(tableReport(clean)).toContain('no deprecated');
    expect(markdownReport(clean)).toContain('No deprecated');
  });
});
