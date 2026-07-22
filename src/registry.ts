import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import bundledRegistry from '../registry/models.json';
import { registrySchema } from './schema.js';
import type { ModelDefinition, Registry } from './types.js';

const MAX_REMOTE_REGISTRY_BYTES = 5 * 1024 * 1024;

function assertRegistryIntegrity(registry: Registry): Registry {
  const identifiers = new Map<string, string>();

  for (const model of registry.models) {
    if (!registry.providers[model.provider]) {
      throw new Error(`Unknown provider "${model.provider}" for model "${model.id}"`);
    }
    if (model.deprecatedAt && model.deprecatedAt > model.shutdownAt) {
      throw new Error(`Deprecation date is after shutdown date for "${model.id}"`);
    }
    if (model.replacement === model.id || model.aliases?.includes(model.replacement ?? '')) {
      throw new Error(`Replacement points back to deprecated model "${model.id}"`);
    }

    for (const identifier of [model.id, ...(model.aliases ?? [])]) {
      const owner = identifiers.get(identifier);
      if (owner) throw new Error(`Duplicate model identifier "${identifier}" in "${owner}" and "${model.id}"`);
      identifiers.set(identifier, model.id);
    }
  }
  return registry;
}

export function validateRegistry(value: unknown): Registry {
  return assertRegistryIntegrity(registrySchema.parse(value) as Registry);
}

export function loadBundledRegistry(): Registry {
  return validateRegistry(bundledRegistry);
}

async function loadRemoteRegistry(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'model-sunset/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}): ${url}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_REMOTE_REGISTRY_BYTES) throw new Error('Remote registry is larger than 5 MiB');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_REMOTE_REGISTRY_BYTES) throw new Error('Remote registry is larger than 5 MiB');
  return JSON.parse(text);
}

export async function loadRegistry(source?: string, root = process.cwd()): Promise<Registry> {
  if (!source) return loadBundledRegistry();
  if (/^https:\/\//i.test(source)) return validateRegistry(await loadRemoteRegistry(source));
  if (/^http:/i.test(source)) throw new Error('Remote registries must use HTTPS');
  const path = isAbsolute(source) ? source : resolve(root, source);
  return validateRegistry(JSON.parse(await readFile(path, 'utf8')));
}

export function modelIdentifiers(model: ModelDefinition): string[] {
  return [model.id, ...(model.aliases ?? [])];
}

export function findModel(registry: Registry, identifier: string): ModelDefinition | undefined {
  return registry.models.find((model) => modelIdentifiers(model).includes(identifier));
}
