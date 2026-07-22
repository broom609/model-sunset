export type ProviderId = 'openai' | 'anthropic' | 'google' | (string & {});

export type LifecycleState = 'deprecated' | 'critical' | 'retired';
export type FailOn = 'deprecated' | 'retired' | 'never';

export interface ProviderDefinition {
  name: string;
  source: string;
}

export interface ModelDefinition {
  id: string;
  aliases?: string[];
  provider: ProviderId;
  deprecatedAt?: string;
  shutdownAt: string;
  replacement?: string;
  note?: string;
}

export interface Registry {
  schemaVersion: 1;
  updatedAt: string;
  providers: Record<string, ProviderDefinition>;
  models: ModelDefinition[];
}

export interface ModelLifecycle extends ModelDefinition {
  state: LifecycleState;
  daysUntilShutdown: number;
}

export interface Finding {
  file: string;
  absolutePath: string;
  line: number;
  column: number;
  offset: number;
  length: number;
  matchedId: string;
  model: ModelLifecycle;
}

export interface ScanStats {
  filesConsidered: number;
  filesScanned: number;
  filesSkipped: number;
  bytesScanned: number;
}

export interface ScanReport {
  root: string;
  generatedAt: string;
  registryUpdatedAt: string;
  findings: Finding[];
  stats: ScanStats;
}

export interface ModelSunsetConfig {
  include: string[];
  exclude: string[];
  ignoreModels: string[];
  daysBeforeShutdown: number;
  failOn: FailOn;
  maxFileBytes: number;
}

export interface MigrationResult {
  changedFiles: string[];
  replacements: number;
  skippedWithoutReplacement: number;
}

export interface AdapterOutput {
  output: unknown;
  costUsd?: number;
  usage?: Record<string, number>;
}

export interface ComparisonResult {
  fixture: string;
  model: string;
  replacement: string;
  passed: boolean;
  shapeCompatible: boolean;
  oldDurationMs: number;
  newDurationMs: number;
  latencyRegressionPercent?: number;
  costRegressionPercent?: number;
  error?: string;
}
