import type { FailOn, LifecycleState, ModelDefinition, ModelLifecycle, ScanReport } from './types.js';

const DAY_MS = 86_400_000;

function utcDate(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function lifecycleFor(
  model: ModelDefinition,
  at = new Date(),
  criticalDays = 90,
): ModelLifecycle {
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const shutdown = utcDate(model.shutdownAt);
  const daysUntilShutdown = Math.ceil((shutdown - today) / DAY_MS);
  let state: LifecycleState = 'deprecated';
  if (daysUntilShutdown <= 0) state = 'retired';
  else if (daysUntilShutdown <= criticalDays) state = 'critical';
  return { ...model, state, daysUntilShutdown };
}

export function shouldFail(report: ScanReport, failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'retired') return report.findings.some((finding) => finding.model.state === 'retired');
  return report.findings.length > 0;
}

export function stateRank(state: LifecycleState): number {
  return state === 'retired' ? 3 : state === 'critical' ? 2 : 1;
}
