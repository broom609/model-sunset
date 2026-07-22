import pc from 'picocolors';
import type { Finding, ScanReport } from '../types.js';

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function stateLabel(finding: Finding, color: boolean): string {
  const label = finding.model.state.toUpperCase();
  if (!color) return label;
  if (finding.model.state === 'retired') return pc.red(label);
  if (finding.model.state === 'critical') return pc.yellow(label);
  return pc.magenta(label);
}

export function tableReport(report: ScanReport, color = process.stdout.isTTY): string {
  if (report.findings.length === 0) {
    return `ModelSunset: no deprecated model references found in ${report.stats.filesScanned} files.`;
  }

  const header = ['STATE', 'MODEL', 'REPLACEMENT', 'SHUTDOWN', 'LOCATION'];
  const rows = report.findings.map((finding) => [
    stateLabel(finding, color),
    truncate(finding.matchedId, 31),
    truncate(finding.model.replacement ?? 'manual migration', 26),
    finding.model.shutdownAt,
    truncate(`${finding.file}:${finding.line}:${finding.column}`, 48),
  ]);
  const plainRows = report.findings.map((finding) => [
    finding.model.state.toUpperCase(),
    truncate(finding.matchedId, 31),
    truncate(finding.model.replacement ?? 'manual migration', 26),
    finding.model.shutdownAt,
    truncate(`${finding.file}:${finding.line}:${finding.column}`, 48),
  ]);
  const widths = header.map((value, column) =>
    Math.max(value.length, ...plainRows.map((row) => row[column]?.length ?? 0)),
  );
  const format = (row: string[]): string =>
    row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join('  ').trimEnd();

  return [
    format(header),
    format(widths.map((width) => '─'.repeat(width))),
    ...rows.map(format),
    '',
    `${report.findings.length} reference(s) in ${new Set(report.findings.map((item) => item.file)).size} file(s). Registry: ${report.registryUpdatedAt}.`,
  ].join('\n');
}
