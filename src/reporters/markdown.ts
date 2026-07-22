import type { ScanReport } from '../types.js';

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function markdownReport(report: ScanReport): string {
  const lines = [
    '# ModelSunset report',
    '',
    `Scanned ${report.stats.filesScanned} files using registry ${report.registryUpdatedAt}.`,
    '',
  ];
  if (report.findings.length === 0) return [...lines, 'No deprecated model references found.', ''].join('\n');
  lines.push(
    '| State | Provider | Model | Replacement | Shutdown | Location |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const finding of report.findings) {
    lines.push(
      `| ${finding.model.state} | ${escapeCell(finding.model.provider)} | \`${escapeCell(finding.matchedId)}\` | ${finding.model.replacement ? `\`${escapeCell(finding.model.replacement)}\`` : 'Manual migration'} | ${finding.model.shutdownAt} | \`${escapeCell(`${finding.file}:${finding.line}:${finding.column}`)}\` |`,
    );
  }
  lines.push('', '> Review model behavior and provider migration guidance before merging automated replacements.', '');
  return lines.join('\n');
}
