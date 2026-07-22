import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import YAML from 'yaml';
import { configSchema } from './schema.js';
import type { ModelSunsetConfig } from './types.js';

const DEFAULT_INCLUDES = [
  '**/*.{cjs,cts,env,go,java,js,json,jsx,md,mjs,mts,php,properties,py,rb,rs,sh,tf,ts,tsx,txt,yaml,yml}',
  '**/.env*',
];

const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/.next/**',
  '**/.venv/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/venv/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

export const defaultConfig: ModelSunsetConfig = {
  include: DEFAULT_INCLUDES,
  exclude: DEFAULT_EXCLUDES,
  ignoreModels: [],
  daysBeforeShutdown: 90,
  failOn: 'deprecated',
  maxFileBytes: 2 * 1024 * 1024,
};

function parseConfig(path: string): unknown {
  const contents = readFileSync(path, 'utf8');
  const extension = extname(path).toLowerCase();
  return extension === '.yaml' || extension === '.yml' ? YAML.parse(contents) : JSON.parse(contents);
}

export function findConfig(root: string): string | undefined {
  for (const name of ['.modelsunset.json', '.modelsunset.yaml', '.modelsunset.yml']) {
    const candidate = resolve(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function loadConfig(root: string, configPath?: string): ModelSunsetConfig {
  const selected = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(root, configPath)
    : findConfig(root);

  if (!selected) return { ...defaultConfig };
  if (!existsSync(selected)) throw new Error(`Config file not found: ${selected}`);

  const parsed = configSchema.parse(parseConfig(selected));
  return {
    include: parsed.include ?? defaultConfig.include,
    exclude: [...defaultConfig.exclude, ...(parsed.exclude ?? [])],
    ignoreModels: parsed.ignoreModels ?? defaultConfig.ignoreModels,
    daysBeforeShutdown: parsed.daysBeforeShutdown ?? defaultConfig.daysBeforeShutdown,
    failOn: parsed.failOn ?? defaultConfig.failOn,
    maxFileBytes: parsed.maxFileBytes ?? defaultConfig.maxFileBytes,
  };
}
