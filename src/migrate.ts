import { readFile, writeFile } from 'node:fs/promises';
import type { Finding, MigrationResult, ScanReport } from './types.js';

interface FileMigration {
  absolutePath: string;
  file: string;
  findings: Finding[];
}

function groupedMigrations(report: ScanReport): FileMigration[] {
  const grouped = new Map<string, FileMigration>();
  for (const finding of report.findings) {
    const existing = grouped.get(finding.absolutePath) ?? {
      absolutePath: finding.absolutePath,
      file: finding.file,
      findings: [],
    };
    existing.findings.push(finding);
    grouped.set(finding.absolutePath, existing);
  }
  return [...grouped.values()];
}

export async function applyMigrations(report: ScanReport, dryRun: boolean): Promise<MigrationResult> {
  const changedFiles: string[] = [];
  let replacements = 0;
  let skippedWithoutReplacement = 0;

  for (const migration of groupedMigrations(report)) {
    const original = await readFile(migration.absolutePath, 'utf8');
    let updated = original;
    const findings = [...migration.findings].sort((left, right) => right.offset - left.offset);
    for (const finding of findings) {
      const replacement = finding.model.replacement;
      if (!replacement) {
        skippedWithoutReplacement += 1;
        continue;
      }
      if (updated.slice(finding.offset, finding.offset + finding.length) !== finding.matchedId) {
        throw new Error(`File changed after scan: ${finding.file}:${finding.line}`);
      }
      updated = `${updated.slice(0, finding.offset)}${replacement}${updated.slice(finding.offset + finding.length)}`;
      replacements += 1;
    }
    if (updated !== original) {
      changedFiles.push(migration.file);
      if (!dryRun) await writeFile(migration.absolutePath, updated, 'utf8');
    }
  }

  return { changedFiles: changedFiles.sort(), replacements, skippedWithoutReplacement };
}
