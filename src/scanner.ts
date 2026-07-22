import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import { modelIdentifiers } from './registry.js';
import { lifecycleFor, stateRank } from './status.js';
import type { Finding, ModelDefinition, ModelSunsetConfig, Registry, ScanReport, ScanStats } from './types.js';

interface IdentifierMatcher {
  identifier: string;
  model: ModelDefinition;
}

export interface ScanOptions {
  root: string;
  registry: Registry;
  config: ModelSunsetConfig;
  at?: Date;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9._:/-]/.test(character);
}

function lineAndColumn(contents: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let index = 0; index < offset; index += 1) {
    if (contents.charCodeAt(index) === 10) {
      line += 1;
      lastNewline = index;
    }
  }
  return { line, column: offset - lastNewline };
}

function buildMatchers(registry: Registry): IdentifierMatcher[] {
  return registry.models
    .flatMap((model) => modelIdentifiers(model).map((identifier) => ({ identifier, model })))
    .sort((left, right) => right.identifier.length - left.identifier.length);
}

function findMatches(contents: string, matchers: IdentifierMatcher[], ignored: Set<string>): Array<{
  offset: number;
  identifier: string;
  model: ModelDefinition;
}> {
  const candidates: Array<{ offset: number; identifier: string; model: ModelDefinition }> = [];
  for (const matcher of matchers) {
    if (ignored.has(matcher.identifier) || ignored.has(matcher.model.id)) continue;
    let from = 0;
    while (from < contents.length) {
      const offset = contents.indexOf(matcher.identifier, from);
      if (offset < 0) break;
      const before = contents[offset - 1];
      const after = contents[offset + matcher.identifier.length];
      if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) {
        candidates.push({ offset, identifier: matcher.identifier, model: matcher.model });
      }
      from = offset + matcher.identifier.length;
    }
  }

  candidates.sort((left, right) => left.offset - right.offset || right.identifier.length - left.identifier.length);
  const accepted: typeof candidates = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.offset < occupiedUntil) continue;
    accepted.push(candidate);
    occupiedUntil = candidate.offset + candidate.identifier.length;
  }
  return accepted;
}

async function filesFor(root: string, config: ModelSunsetConfig): Promise<{ base: string; files: string[] }> {
  const absolute = resolve(root);
  const info = await stat(absolute);
  if (info.isFile()) return { base: resolve(absolute, '..'), files: [absolute] };
  if (!info.isDirectory()) throw new Error(`Scan path is not a file or directory: ${absolute}`);
  const entries = await fg(config.include, {
    cwd: absolute,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: config.exclude,
    followSymbolicLinks: false,
    suppressErrors: false,
  });
  return { base: absolute, files: entries.sort() };
}

export async function scanPath(options: ScanOptions): Promise<ScanReport> {
  const { base, files } = await filesFor(options.root, options.config);
  const matchers = buildMatchers(options.registry);
  const ignored = new Set(options.config.ignoreModels);
  const findings: Finding[] = [];
  const stats: ScanStats = {
    filesConsidered: files.length,
    filesScanned: 0,
    filesSkipped: 0,
    bytesScanned: 0,
  };

  for (const absolutePath of files) {
    const buffer = await readFile(absolutePath);
    if (buffer.length > options.config.maxFileBytes || buffer.includes(0)) {
      stats.filesSkipped += 1;
      continue;
    }
    stats.filesScanned += 1;
    stats.bytesScanned += buffer.length;
    const contents = buffer.toString('utf8');
    const file = relative(base, absolutePath).split(sep).join('/');
    for (const match of findMatches(contents, matchers, ignored)) {
      const position = lineAndColumn(contents, match.offset);
      findings.push({
        file,
        absolutePath,
        line: position.line,
        column: position.column,
        offset: match.offset,
        length: match.identifier.length,
        matchedId: match.identifier,
        model: lifecycleFor(match.model, options.at, options.config.daysBeforeShutdown),
      });
    }
  }

  findings.sort(
    (left, right) =>
      stateRank(right.model.state) - stateRank(left.model.state) ||
      left.file.localeCompare(right.file) ||
      left.offset - right.offset,
  );

  return {
    root: isAbsolute(options.root) ? options.root : resolve(options.root),
    generatedAt: (options.at ?? new Date()).toISOString(),
    registryUpdatedAt: options.registry.updatedAt,
    findings,
    stats,
  };
}
