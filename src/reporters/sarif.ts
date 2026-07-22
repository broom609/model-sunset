import type { Finding, ScanReport } from '../types.js';

function ruleId(finding: Finding): string {
  return `modelsunset/${finding.model.provider}/${finding.model.state}`;
}

function level(finding: Finding): 'error' | 'warning' {
  return finding.model.state === 'retired' ? 'error' : 'warning';
}

export function sarifReport(report: ScanReport): object {
  const rules = new Map<string, object>();
  for (const finding of report.findings) {
    const id = ruleId(finding);
    rules.set(id, {
      id,
      name: `AI model ${finding.model.state}`,
      shortDescription: { text: `References an AI model that is ${finding.model.state}.` },
      helpUri: finding.model.note ? undefined : undefined,
      defaultConfiguration: { level: level(finding) },
    });
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ModelSunset',
            informationUri: 'https://github.com/broom609/model-sunset',
            semanticVersion: '1.0.0',
            rules: [...rules.values()],
          },
        },
        results: report.findings.map((finding) => ({
          ruleId: ruleId(finding),
          level: level(finding),
          message: {
            text: `${finding.matchedId} shuts down on ${finding.model.shutdownAt}.${finding.model.replacement ? ` Recommended replacement: ${finding.model.replacement}.` : ''}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: {
                  startLine: finding.line,
                  startColumn: finding.column,
                  endColumn: finding.column + finding.length,
                },
              },
            },
          ],
          properties: {
            provider: finding.model.provider,
            model: finding.matchedId,
            replacement: finding.model.replacement,
            shutdownAt: finding.model.shutdownAt,
            daysUntilShutdown: finding.model.daysUntilShutdown,
          },
        })),
      },
    ],
  };
}
