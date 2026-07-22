type ProviderId = 'openai' | 'anthropic' | 'google' | (string & {});
type LifecycleState = 'deprecated' | 'critical' | 'retired';
type FailOn = 'deprecated' | 'retired' | 'never';
interface ProviderDefinition {
    name: string;
    source: string;
}
interface ModelDefinition {
    id: string;
    aliases?: string[];
    provider: ProviderId;
    deprecatedAt?: string;
    shutdownAt: string;
    replacement?: string;
    note?: string;
}
interface Registry {
    schemaVersion: 1;
    updatedAt: string;
    providers: Record<string, ProviderDefinition>;
    models: ModelDefinition[];
}
interface ModelLifecycle extends ModelDefinition {
    state: LifecycleState;
    daysUntilShutdown: number;
}
interface Finding {
    file: string;
    absolutePath: string;
    line: number;
    column: number;
    offset: number;
    length: number;
    matchedId: string;
    model: ModelLifecycle;
}
interface ScanStats {
    filesConsidered: number;
    filesScanned: number;
    filesSkipped: number;
    bytesScanned: number;
}
interface ScanReport {
    root: string;
    generatedAt: string;
    registryUpdatedAt: string;
    findings: Finding[];
    stats: ScanStats;
}
interface ModelSunsetConfig {
    include: string[];
    exclude: string[];
    ignoreModels: string[];
    daysBeforeShutdown: number;
    failOn: FailOn;
    maxFileBytes: number;
}
interface MigrationResult {
    changedFiles: string[];
    replacements: number;
    skippedWithoutReplacement: number;
}
interface AdapterOutput {
    output: unknown;
    costUsd?: number;
    usage?: Record<string, number>;
}
interface ComparisonResult {
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

interface CompareOptions {
    model: string;
    replacement: string;
    fixturesPath: string;
    command: string;
    timeoutMs?: number;
    maxLatencyRegressionPercent?: number;
    maxCostRegressionPercent?: number;
}
declare function compareModels(options: CompareOptions): Promise<ComparisonResult[]>;

declare const defaultConfig: ModelSunsetConfig;
declare function findConfig(root: string): string | undefined;
declare function loadConfig(root: string, configPath?: string): ModelSunsetConfig;

declare function applyMigrations(report: ScanReport, dryRun: boolean): Promise<MigrationResult>;

declare function markdownReport(report: ScanReport): string;

declare function sarifReport(report: ScanReport): object;

declare function tableReport(report: ScanReport, color?: boolean): string;

declare function validateRegistry(value: unknown): Registry;
declare function loadBundledRegistry(): Registry;
declare function loadRegistry(source?: string, root?: string): Promise<Registry>;
declare function modelIdentifiers(model: ModelDefinition): string[];
declare function findModel(registry: Registry, identifier: string): ModelDefinition | undefined;

interface ScanOptions {
    root: string;
    registry: Registry;
    config: ModelSunsetConfig;
    at?: Date;
}
declare function scanPath(options: ScanOptions): Promise<ScanReport>;

declare function lifecycleFor(model: ModelDefinition, at?: Date, criticalDays?: number): ModelLifecycle;
declare function shouldFail(report: ScanReport, failOn: FailOn): boolean;

export { type AdapterOutput, type ComparisonResult, type FailOn, type Finding, type LifecycleState, type MigrationResult, type ModelDefinition, type ModelLifecycle, type ModelSunsetConfig, type ProviderDefinition, type ProviderId, type Registry, type ScanReport, type ScanStats, applyMigrations, compareModels, defaultConfig, findConfig, findModel, lifecycleFor, loadBundledRegistry, loadConfig, loadRegistry, markdownReport, modelIdentifiers, sarifReport, scanPath, shouldFail, tableReport, validateRegistry };
