import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { adapterOutputSchema, fixtureFileSchema } from './schema.js';
import type { AdapterOutput, ComparisonResult } from './types.js';

export interface CompareOptions {
  model: string;
  replacement: string;
  fixturesPath: string;
  command: string;
  timeoutMs?: number;
  maxLatencyRegressionPercent?: number;
  maxCostRegressionPercent?: number;
}

interface CommandResult {
  output: AdapterOutput;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function shapeSignature(value: unknown, path = '$'): string[] {
  if (value === null) return [`${path}:null`];
  if (Array.isArray(value)) {
    const shapes = value.slice(0, 10).flatMap((item) => shapeSignature(item, `${path}[]`));
    return [`${path}:array`, ...new Set(shapes)].sort();
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return [`${path}:object`, ...entries.flatMap(([key, child]) => shapeSignature(child, `${path}.${key}`))];
  }
  return [`${path}:${typeof value}`];
}

function regressionPercent(oldValue: number | undefined, newValue: number | undefined): number | undefined {
  if (oldValue === undefined || newValue === undefined) return undefined;
  if (oldValue === 0) return newValue === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((newValue - oldValue) / oldValue) * 100;
}

async function runAdapter(
  command: string,
  model: string,
  fixture: unknown,
  timeoutMs: number,
): Promise<CommandResult> {
  const started = performance.now();
  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        MODELSUNSET_MODEL: model,
        MODELSUNSET_FIXTURE_JSON: JSON.stringify(fixture),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Comparison command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        reject(new Error('Comparison command output exceeded 2 MiB'));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Comparison command exited ${code}: ${stderr.trim() || 'no stderr'}`));
        return;
      }
      try {
        const output = adapterOutputSchema.parse(JSON.parse(stdout)) as AdapterOutput;
        resolvePromise({ output, durationMs: performance.now() - started });
      } catch (error) {
        reject(new Error(`Comparison command must print one JSON object: ${String(error)}`));
      }
    });
  });
}

export async function compareModels(options: CompareOptions): Promise<ComparisonResult[]> {
  const fixtures = fixtureFileSchema.parse(JSON.parse(await readFile(options.fixturesPath, 'utf8')));
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxLatency = options.maxLatencyRegressionPercent ?? 50;
  const maxCost = options.maxCostRegressionPercent ?? 25;
  const results: ComparisonResult[] = [];

  for (const fixture of fixtures) {
    try {
      const oldRun = await runAdapter(options.command, options.model, fixture.input, timeoutMs);
      const newRun = await runAdapter(options.command, options.replacement, fixture.input, timeoutMs);
      const shapeCompatible = JSON.stringify(shapeSignature(oldRun.output.output)) === JSON.stringify(shapeSignature(newRun.output.output));
      const latencyRegressionPercent = regressionPercent(oldRun.durationMs, newRun.durationMs);
      const costRegressionPercent = regressionPercent(oldRun.output.costUsd, newRun.output.costUsd);
      const passed =
        shapeCompatible &&
        (latencyRegressionPercent ?? 0) <= maxLatency &&
        (costRegressionPercent ?? 0) <= maxCost;
      results.push({
        fixture: fixture.name,
        model: options.model,
        replacement: options.replacement,
        passed,
        shapeCompatible,
        oldDurationMs: Math.round(oldRun.durationMs),
        newDurationMs: Math.round(newRun.durationMs),
        ...(latencyRegressionPercent === undefined ? {} : { latencyRegressionPercent }),
        ...(costRegressionPercent === undefined ? {} : { costRegressionPercent }),
      });
    } catch (error) {
      results.push({
        fixture: fixture.name,
        model: options.model,
        replacement: options.replacement,
        passed: false,
        shapeCompatible: false,
        oldDurationMs: 0,
        newDurationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
