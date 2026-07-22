import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const modelDefinitionSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1),
  deprecatedAt: isoDate.optional(),
  shutdownAt: isoDate,
  replacement: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

export const registrySchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: isoDate,
  providers: z.record(
    z.string(),
    z.object({
      name: z.string().min(1),
      source: z.url(),
    }),
  ),
  models: z.array(modelDefinitionSchema).min(1),
});

export const configSchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional(),
  ignoreModels: z.array(z.string().min(1)).optional(),
  daysBeforeShutdown: z.int().min(0).max(3650).optional(),
  failOn: z.enum(['deprecated', 'retired', 'never']).optional(),
  maxFileBytes: z.int().min(1).max(100 * 1024 * 1024).optional(),
});

export const fixtureFileSchema = z.array(
  z.object({
    name: z.string().min(1),
    input: z.unknown(),
  }),
);

export const adapterOutputSchema = z.object({
  output: z.unknown(),
  costUsd: z.number().nonnegative().optional(),
  usage: z.record(z.string(), z.number()).optional(),
});
