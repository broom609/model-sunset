// src/compare.ts
import { readFile } from "fs/promises";
import { spawn } from "child_process";

// src/schema.ts
import { z } from "zod";
var isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
var modelDefinitionSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1),
  deprecatedAt: isoDate.optional(),
  shutdownAt: isoDate,
  replacement: z.string().min(1).optional(),
  note: z.string().min(1).optional()
});
var registrySchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: isoDate,
  providers: z.record(
    z.string(),
    z.object({
      name: z.string().min(1),
      source: z.url()
    })
  ),
  models: z.array(modelDefinitionSchema).min(1)
});
var configSchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional(),
  ignoreModels: z.array(z.string().min(1)).optional(),
  daysBeforeShutdown: z.int().min(0).max(3650).optional(),
  failOn: z.enum(["deprecated", "retired", "never"]).optional(),
  maxFileBytes: z.int().min(1).max(100 * 1024 * 1024).optional()
});
var fixtureFileSchema = z.array(
  z.object({
    name: z.string().min(1),
    input: z.unknown()
  })
);
var adapterOutputSchema = z.object({
  output: z.unknown(),
  costUsd: z.number().nonnegative().optional(),
  usage: z.record(z.string(), z.number()).optional()
});

// src/compare.ts
var MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
function shapeSignature(value, path = "$") {
  if (value === null) return [`${path}:null`];
  if (Array.isArray(value)) {
    const shapes = value.slice(0, 10).flatMap((item) => shapeSignature(item, `${path}[]`));
    return [`${path}:array`, ...new Set(shapes)].sort();
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return [`${path}:object`, ...entries.flatMap(([key, child]) => shapeSignature(child, `${path}.${key}`))];
  }
  return [`${path}:${typeof value}`];
}
function regressionPercent(oldValue, newValue) {
  if (oldValue === void 0 || newValue === void 0) return void 0;
  if (oldValue === 0) return newValue === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (newValue - oldValue) / oldValue * 100;
}
async function runAdapter(command, model, fixture, timeoutMs) {
  const started = performance.now();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, {
      shell: true,
      env: {
        ...process.env,
        MODELSUNSET_MODEL: model,
        MODELSUNSET_FIXTURE_JSON: JSON.stringify(fixture)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Comparison command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        reject(new Error("Comparison command output exceeded 2 MiB"));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Comparison command exited ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      try {
        const output = adapterOutputSchema.parse(JSON.parse(stdout));
        resolvePromise({ output, durationMs: performance.now() - started });
      } catch (error) {
        reject(new Error(`Comparison command must print one JSON object: ${String(error)}`));
      }
    });
  });
}
async function compareModels(options) {
  const fixtures = fixtureFileSchema.parse(JSON.parse(await readFile(options.fixturesPath, "utf8")));
  const timeoutMs = options.timeoutMs ?? 6e4;
  const maxLatency = options.maxLatencyRegressionPercent ?? 50;
  const maxCost = options.maxCostRegressionPercent ?? 25;
  const results = [];
  for (const fixture of fixtures) {
    try {
      const oldRun = await runAdapter(options.command, options.model, fixture.input, timeoutMs);
      const newRun = await runAdapter(options.command, options.replacement, fixture.input, timeoutMs);
      const shapeCompatible = JSON.stringify(shapeSignature(oldRun.output.output)) === JSON.stringify(shapeSignature(newRun.output.output));
      const latencyRegressionPercent = regressionPercent(oldRun.durationMs, newRun.durationMs);
      const costRegressionPercent = regressionPercent(oldRun.output.costUsd, newRun.output.costUsd);
      const passed = shapeCompatible && (latencyRegressionPercent ?? 0) <= maxLatency && (costRegressionPercent ?? 0) <= maxCost;
      results.push({
        fixture: fixture.name,
        model: options.model,
        replacement: options.replacement,
        passed,
        shapeCompatible,
        oldDurationMs: Math.round(oldRun.durationMs),
        newDurationMs: Math.round(newRun.durationMs),
        ...latencyRegressionPercent === void 0 ? {} : { latencyRegressionPercent },
        ...costRegressionPercent === void 0 ? {} : { costRegressionPercent }
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
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

// src/config.ts
import { existsSync, readFileSync } from "fs";
import { extname, isAbsolute, resolve } from "path";
import YAML from "yaml";
var DEFAULT_INCLUDES = [
  "**/*.{cjs,cts,env,go,java,js,json,jsx,md,mjs,mts,php,properties,py,rb,rs,sh,tf,ts,tsx,txt,yaml,yml}",
  "**/.env*"
];
var DEFAULT_EXCLUDES = [
  "**/.git/**",
  "**/.next/**",
  "**/.venv/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/venv/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock"
];
var defaultConfig = {
  include: DEFAULT_INCLUDES,
  exclude: DEFAULT_EXCLUDES,
  ignoreModels: [],
  daysBeforeShutdown: 90,
  failOn: "deprecated",
  maxFileBytes: 2 * 1024 * 1024
};
function parseConfig(path) {
  const contents = readFileSync(path, "utf8");
  const extension = extname(path).toLowerCase();
  return extension === ".yaml" || extension === ".yml" ? YAML.parse(contents) : JSON.parse(contents);
}
function findConfig(root) {
  for (const name of [".modelsunset.json", ".modelsunset.yaml", ".modelsunset.yml"]) {
    const candidate = resolve(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return void 0;
}
function loadConfig(root, configPath) {
  const selected = configPath ? isAbsolute(configPath) ? configPath : resolve(root, configPath) : findConfig(root);
  if (!selected) return { ...defaultConfig };
  if (!existsSync(selected)) throw new Error(`Config file not found: ${selected}`);
  const parsed = configSchema.parse(parseConfig(selected));
  return {
    include: parsed.include ?? defaultConfig.include,
    exclude: [...defaultConfig.exclude, ...parsed.exclude ?? []],
    ignoreModels: parsed.ignoreModels ?? defaultConfig.ignoreModels,
    daysBeforeShutdown: parsed.daysBeforeShutdown ?? defaultConfig.daysBeforeShutdown,
    failOn: parsed.failOn ?? defaultConfig.failOn,
    maxFileBytes: parsed.maxFileBytes ?? defaultConfig.maxFileBytes
  };
}

// src/migrate.ts
import { readFile as readFile2, writeFile } from "fs/promises";
function groupedMigrations(report) {
  const grouped = /* @__PURE__ */ new Map();
  for (const finding of report.findings) {
    const existing = grouped.get(finding.absolutePath) ?? {
      absolutePath: finding.absolutePath,
      file: finding.file,
      findings: []
    };
    existing.findings.push(finding);
    grouped.set(finding.absolutePath, existing);
  }
  return [...grouped.values()];
}
async function applyMigrations(report, dryRun) {
  const changedFiles = [];
  let replacements = 0;
  let skippedWithoutReplacement = 0;
  for (const migration of groupedMigrations(report)) {
    const original = await readFile2(migration.absolutePath, "utf8");
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
      if (!dryRun) await writeFile(migration.absolutePath, updated, "utf8");
    }
  }
  return { changedFiles: changedFiles.sort(), replacements, skippedWithoutReplacement };
}

// src/reporters/markdown.ts
function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
function markdownReport(report) {
  const lines = [
    "# ModelSunset report",
    "",
    `Scanned ${report.stats.filesScanned} files using registry ${report.registryUpdatedAt}.`,
    ""
  ];
  if (report.findings.length === 0) return [...lines, "No deprecated model references found.", ""].join("\n");
  lines.push(
    "| State | Provider | Model | Replacement | Shutdown | Location |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const finding of report.findings) {
    lines.push(
      `| ${finding.model.state} | ${escapeCell(finding.model.provider)} | \`${escapeCell(finding.matchedId)}\` | ${finding.model.replacement ? `\`${escapeCell(finding.model.replacement)}\`` : "Manual migration"} | ${finding.model.shutdownAt} | \`${escapeCell(`${finding.file}:${finding.line}:${finding.column}`)}\` |`
    );
  }
  lines.push("", "> Review model behavior and provider migration guidance before merging automated replacements.", "");
  return lines.join("\n");
}

// src/reporters/sarif.ts
function ruleId(finding) {
  return `modelsunset/${finding.model.provider}/${finding.model.state}`;
}
function level(finding) {
  return finding.model.state === "retired" ? "error" : "warning";
}
function sarifReport(report) {
  const rules = /* @__PURE__ */ new Map();
  for (const finding of report.findings) {
    const id = ruleId(finding);
    rules.set(id, {
      id,
      name: `AI model ${finding.model.state}`,
      shortDescription: { text: `References an AI model that is ${finding.model.state}.` },
      helpUri: finding.model.note ? void 0 : void 0,
      defaultConfiguration: { level: level(finding) }
    });
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ModelSunset",
            informationUri: "https://github.com/broom609/model-sunset",
            semanticVersion: "1.0.0",
            rules: [...rules.values()]
          }
        },
        results: report.findings.map((finding) => ({
          ruleId: ruleId(finding),
          level: level(finding),
          message: {
            text: `${finding.matchedId} shuts down on ${finding.model.shutdownAt}.${finding.model.replacement ? ` Recommended replacement: ${finding.model.replacement}.` : ""}`
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: {
                  startLine: finding.line,
                  startColumn: finding.column,
                  endColumn: finding.column + finding.length
                }
              }
            }
          ],
          properties: {
            provider: finding.model.provider,
            model: finding.matchedId,
            replacement: finding.model.replacement,
            shutdownAt: finding.model.shutdownAt,
            daysUntilShutdown: finding.model.daysUntilShutdown
          }
        }))
      }
    ]
  };
}

// src/reporters/table.ts
import pc from "picocolors";
function truncate(value, width) {
  return value.length <= width ? value : `${value.slice(0, width - 1)}\u2026`;
}
function stateLabel(finding, color) {
  const label = finding.model.state.toUpperCase();
  if (!color) return label;
  if (finding.model.state === "retired") return pc.red(label);
  if (finding.model.state === "critical") return pc.yellow(label);
  return pc.magenta(label);
}
function tableReport(report, color = process.stdout.isTTY) {
  if (report.findings.length === 0) {
    return `ModelSunset: no deprecated model references found in ${report.stats.filesScanned} files.`;
  }
  const header = ["STATE", "MODEL", "REPLACEMENT", "SHUTDOWN", "LOCATION"];
  const rows = report.findings.map((finding) => [
    stateLabel(finding, color),
    truncate(finding.matchedId, 31),
    truncate(finding.model.replacement ?? "manual migration", 26),
    finding.model.shutdownAt,
    truncate(`${finding.file}:${finding.line}:${finding.column}`, 48)
  ]);
  const plainRows = report.findings.map((finding) => [
    finding.model.state.toUpperCase(),
    truncate(finding.matchedId, 31),
    truncate(finding.model.replacement ?? "manual migration", 26),
    finding.model.shutdownAt,
    truncate(`${finding.file}:${finding.line}:${finding.column}`, 48)
  ]);
  const widths = header.map(
    (value, column) => Math.max(value.length, ...plainRows.map((row) => row[column]?.length ?? 0))
  );
  const format = (row) => row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join("  ").trimEnd();
  return [
    format(header),
    format(widths.map((width) => "\u2500".repeat(width))),
    ...rows.map(format),
    "",
    `${report.findings.length} reference(s) in ${new Set(report.findings.map((item) => item.file)).size} file(s). Registry: ${report.registryUpdatedAt}.`
  ].join("\n");
}

// src/registry.ts
import { readFile as readFile3 } from "fs/promises";
import { isAbsolute as isAbsolute2, resolve as resolve2 } from "path";

// registry/models.json
var models_default = {
  schemaVersion: 1,
  updatedAt: "2026-07-22",
  providers: {
    openai: {
      name: "OpenAI",
      source: "https://developers.openai.com/api/docs/deprecations"
    },
    anthropic: {
      name: "Anthropic",
      source: "https://platform.claude.com/docs/en/about-claude/model-deprecations"
    },
    google: {
      name: "Google Gemini API",
      source: "https://ai.google.dev/gemini-api/docs/deprecations"
    }
  },
  models: [
    {
      id: "computer-use-preview-2025-03-11",
      aliases: ["computer-use-preview"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-4o-mini-search-preview-2025-03-11",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-4o-search-preview-2025-03-11",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-5-chat-latest",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-5-codex",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-5.1-chat-latest",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-5.1-codex",
      aliases: ["gpt-5.1-codex-max"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-5.1-codex-mini",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "o3-deep-research-2025-06-26",
      aliases: ["o3-deep-research"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5-pro"
    },
    {
      id: "o4-mini-deep-research-2025-06-26",
      aliases: ["o4-mini-deep-research"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-07-23",
      replacement: "gpt-5.5-pro"
    },
    {
      id: "gpt-5.2-chat-latest",
      aliases: ["gpt-5.3-chat-latest"],
      provider: "openai",
      deprecatedAt: "2026-05-08",
      shutdownAt: "2026-08-10",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-image-1-mini",
      aliases: ["gpt-image-1.5", "chatgpt-image-latest"],
      provider: "openai",
      deprecatedAt: "2026-06-02",
      shutdownAt: "2026-12-01",
      replacement: "gpt-image-2"
    },
    {
      id: "gpt-5-2025-08-07",
      aliases: ["o3-2025-04-16"],
      provider: "openai",
      deprecatedAt: "2026-06-11",
      shutdownAt: "2026-12-11",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-5-mini-2025-08-07",
      provider: "openai",
      deprecatedAt: "2026-06-11",
      shutdownAt: "2026-12-11",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-5-nano-2025-08-07",
      provider: "openai",
      deprecatedAt: "2026-06-11",
      shutdownAt: "2026-12-11",
      replacement: "gpt-5.4-nano"
    },
    {
      id: "gpt-5-pro-2025-10-06",
      aliases: ["o3-pro-2025-06-10"],
      provider: "openai",
      deprecatedAt: "2026-06-11",
      shutdownAt: "2026-12-11",
      replacement: "gpt-5.5-pro"
    },
    {
      id: "gpt-realtime",
      aliases: ["gpt-4o-realtime"],
      provider: "openai",
      deprecatedAt: "2026-07-20",
      shutdownAt: "2027-01-20",
      replacement: "gpt-realtime-2.1"
    },
    {
      id: "gpt-audio",
      aliases: ["gpt-4o-audio", "gpt-audio-mini"],
      provider: "openai",
      deprecatedAt: "2026-07-20",
      shutdownAt: "2027-01-20",
      replacement: "gpt-audio-1.5"
    },
    {
      id: "gpt-realtime-mini",
      aliases: ["gpt-4o-mini-realtime"],
      provider: "openai",
      deprecatedAt: "2026-07-20",
      shutdownAt: "2027-01-20",
      replacement: "gpt-realtime-2.1-mini"
    },
    {
      id: "gpt-3.5-turbo-0125",
      aliases: ["gpt-3.5-turbo", "gpt-3.5-turbo-completions"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-4-0613",
      aliases: ["gpt-4", "gpt-4-0613-completions", "gpt-4-completions"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-4-turbo-2024-04-09",
      aliases: ["gpt-4-turbo", "gpt-4-turbo-completions"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-4.1-nano-2025-04-14",
      aliases: ["gpt-4.1-nano"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.4-nano"
    },
    {
      id: "gpt-4o-2024-05-13",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.5"
    },
    {
      id: "gpt-image-1",
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-image-2"
    },
    {
      id: "o1-2024-12-17",
      aliases: ["o1"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.5"
    },
    {
      id: "o3-mini-2025-01-31",
      aliases: ["o3-mini"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.5"
    },
    {
      id: "o4-mini-2025-04-16",
      aliases: ["o4-mini"],
      provider: "openai",
      deprecatedAt: "2026-04-22",
      shutdownAt: "2026-10-23",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "gpt-3.5-turbo-instruct",
      aliases: ["babbage-002", "davinci-002", "gpt-3.5-turbo-1106"],
      provider: "openai",
      deprecatedAt: "2025-09-26",
      shutdownAt: "2026-09-28",
      replacement: "gpt-5.4-mini"
    },
    {
      id: "sora-2",
      aliases: ["sora-2-pro", "sora-2-2025-10-06", "sora-2-2025-12-08", "sora-2-pro-2025-10-06"],
      provider: "openai",
      deprecatedAt: "2026-03-24",
      shutdownAt: "2026-09-24",
      note: "No direct replacement is listed by the provider."
    },
    {
      id: "claude-mythos-preview",
      provider: "anthropic",
      deprecatedAt: "2026-07-01",
      shutdownAt: "2026-07-21",
      replacement: "claude-mythos-5"
    },
    {
      id: "claude-opus-4-1-20250805",
      provider: "anthropic",
      deprecatedAt: "2026-06-05",
      shutdownAt: "2026-08-05",
      replacement: "claude-opus-4-8"
    },
    {
      id: "claude-opus-4-20250514",
      provider: "anthropic",
      deprecatedAt: "2026-04-14",
      shutdownAt: "2026-06-15",
      replacement: "claude-opus-4-8"
    },
    {
      id: "claude-sonnet-4-20250514",
      provider: "anthropic",
      deprecatedAt: "2026-04-14",
      shutdownAt: "2026-06-15",
      replacement: "claude-sonnet-4-6"
    },
    {
      id: "claude-3-7-sonnet-20250219",
      provider: "anthropic",
      deprecatedAt: "2025-10-28",
      shutdownAt: "2026-02-19",
      replacement: "claude-sonnet-4-6"
    },
    {
      id: "claude-3-5-haiku-20241022",
      provider: "anthropic",
      deprecatedAt: "2025-12-19",
      shutdownAt: "2026-02-19",
      replacement: "claude-haiku-4-5-20251001"
    },
    {
      id: "claude-3-haiku-20240307",
      provider: "anthropic",
      deprecatedAt: "2026-02-19",
      shutdownAt: "2026-04-20",
      replacement: "claude-haiku-4-5-20251001"
    },
    {
      id: "claude-3-5-sonnet-20240620",
      aliases: ["claude-3-5-sonnet-20241022"],
      provider: "anthropic",
      deprecatedAt: "2025-08-13",
      shutdownAt: "2025-10-28",
      replacement: "claude-sonnet-4-6"
    },
    {
      id: "claude-3-opus-20240229",
      provider: "anthropic",
      deprecatedAt: "2025-06-30",
      shutdownAt: "2026-01-05",
      replacement: "claude-opus-4-8"
    },
    {
      id: "claude-2.0",
      aliases: ["claude-2.1"],
      provider: "anthropic",
      deprecatedAt: "2025-01-21",
      shutdownAt: "2025-07-21",
      replacement: "claude-opus-4-8"
    },
    {
      id: "claude-3-sonnet-20240229",
      provider: "anthropic",
      deprecatedAt: "2025-01-21",
      shutdownAt: "2025-07-21",
      replacement: "claude-sonnet-4-6"
    },
    {
      id: "gemini-3.1-flash-lite",
      provider: "google",
      shutdownAt: "2027-05-07",
      replacement: "gemini-3.5-flash-lite",
      note: "Google lists this as the earliest possible shutdown date."
    },
    {
      id: "gemini-3.1-flash-image-preview",
      provider: "google",
      shutdownAt: "2026-06-25",
      replacement: "gemini-3.1-flash-image"
    },
    {
      id: "gemini-3-pro-image-preview",
      provider: "google",
      shutdownAt: "2026-06-25",
      replacement: "gemini-3-pro-image"
    },
    {
      id: "gemini-3-pro-preview",
      provider: "google",
      shutdownAt: "2026-03-09",
      replacement: "gemini-3.1-pro-preview"
    },
    {
      id: "gemini-3.1-flash-lite-preview",
      provider: "google",
      shutdownAt: "2026-05-25",
      replacement: "gemini-3.1-flash-lite"
    },
    {
      id: "gemini-2.5-pro",
      provider: "google",
      shutdownAt: "2026-10-16",
      replacement: "gemini-3.1-pro-preview",
      note: "Google lists this as the earliest possible shutdown date."
    },
    {
      id: "gemini-2.5-flash",
      provider: "google",
      shutdownAt: "2026-10-16",
      replacement: "gemini-3.6-flash",
      note: "Google lists this as the earliest possible shutdown date."
    },
    {
      id: "gemini-2.5-flash-image",
      provider: "google",
      shutdownAt: "2026-10-02",
      replacement: "gemini-3.1-flash-image-preview",
      note: "Google lists this as the earliest possible shutdown date."
    },
    {
      id: "gemini-2.5-flash-lite",
      provider: "google",
      shutdownAt: "2026-10-16",
      replacement: "gemini-3.1-flash-lite",
      note: "Google lists this as the earliest possible shutdown date."
    },
    {
      id: "gemini-2.0-flash",
      aliases: ["gemini-2.0-flash-001"],
      provider: "google",
      shutdownAt: "2026-06-01",
      replacement: "gemini-3.6-flash"
    },
    {
      id: "gemini-2.0-flash-lite",
      aliases: ["gemini-2.0-flash-lite-001"],
      provider: "google",
      shutdownAt: "2026-06-01",
      replacement: "gemini-3.1-flash-lite"
    },
    {
      id: "gemini-embedding-001",
      provider: "google",
      shutdownAt: "2026-07-14",
      replacement: "gemini-embedding-2"
    },
    {
      id: "embedding-2-preview",
      provider: "google",
      shutdownAt: "2026-08-10",
      replacement: "gemini-embedding-2"
    },
    {
      id: "text-embedding-004",
      provider: "google",
      shutdownAt: "2026-01-14",
      replacement: "gemini-embedding-2"
    },
    {
      id: "imagen-4.0-generate-001",
      provider: "google",
      shutdownAt: "2026-08-17",
      replacement: "gemini-3.1-flash-image"
    },
    {
      id: "imagen-4.0-ultra-generate-001",
      provider: "google",
      shutdownAt: "2026-08-17",
      replacement: "gemini-3.1-flash-image"
    },
    {
      id: "imagen-4.0-fast-generate-001",
      provider: "google",
      shutdownAt: "2026-08-17",
      replacement: "gemini-3.1-flash-image"
    },
    {
      id: "gemini-robotics-er-1.5-preview",
      provider: "google",
      shutdownAt: "2026-04-30",
      replacement: "gemini-robotics-er-1.6-preview"
    }
  ]
};

// src/registry.ts
var MAX_REMOTE_REGISTRY_BYTES = 5 * 1024 * 1024;
function assertRegistryIntegrity(registry) {
  const identifiers = /* @__PURE__ */ new Map();
  for (const model of registry.models) {
    if (!registry.providers[model.provider]) {
      throw new Error(`Unknown provider "${model.provider}" for model "${model.id}"`);
    }
    if (model.deprecatedAt && model.deprecatedAt > model.shutdownAt) {
      throw new Error(`Deprecation date is after shutdown date for "${model.id}"`);
    }
    if (model.replacement === model.id || model.aliases?.includes(model.replacement ?? "")) {
      throw new Error(`Replacement points back to deprecated model "${model.id}"`);
    }
    for (const identifier of [model.id, ...model.aliases ?? []]) {
      const owner = identifiers.get(identifier);
      if (owner) throw new Error(`Duplicate model identifier "${identifier}" in "${owner}" and "${model.id}"`);
      identifiers.set(identifier, model.id);
    }
  }
  return registry;
}
function validateRegistry(value) {
  return assertRegistryIntegrity(registrySchema.parse(value));
}
function loadBundledRegistry() {
  return validateRegistry(models_default);
}
async function loadRemoteRegistry(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "model-sunset/1.0" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}): ${url}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_REMOTE_REGISTRY_BYTES) throw new Error("Remote registry is larger than 5 MiB");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_REMOTE_REGISTRY_BYTES) throw new Error("Remote registry is larger than 5 MiB");
  return JSON.parse(text);
}
async function loadRegistry(source, root = process.cwd()) {
  if (!source) return loadBundledRegistry();
  if (/^https:\/\//i.test(source)) return validateRegistry(await loadRemoteRegistry(source));
  if (/^http:/i.test(source)) throw new Error("Remote registries must use HTTPS");
  const path = isAbsolute2(source) ? source : resolve2(root, source);
  return validateRegistry(JSON.parse(await readFile3(path, "utf8")));
}
function modelIdentifiers(model) {
  return [model.id, ...model.aliases ?? []];
}
function findModel(registry, identifier) {
  return registry.models.find((model) => modelIdentifiers(model).includes(identifier));
}

// src/status.ts
var DAY_MS = 864e5;
function utcDate(value) {
  return Date.parse(`${value}T00:00:00.000Z`);
}
function lifecycleFor(model, at = /* @__PURE__ */ new Date(), criticalDays = 90) {
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const shutdown = utcDate(model.shutdownAt);
  const daysUntilShutdown = Math.ceil((shutdown - today) / DAY_MS);
  let state = "deprecated";
  if (daysUntilShutdown <= 0) state = "retired";
  else if (daysUntilShutdown <= criticalDays) state = "critical";
  return { ...model, state, daysUntilShutdown };
}
function shouldFail(report, failOn) {
  if (failOn === "never") return false;
  if (failOn === "retired") return report.findings.some((finding) => finding.model.state === "retired");
  return report.findings.length > 0;
}
function stateRank(state) {
  return state === "retired" ? 3 : state === "critical" ? 2 : 1;
}

// src/scanner.ts
import { readFile as readFile4, stat } from "fs/promises";
import { isAbsolute as isAbsolute3, relative, resolve as resolve3, sep } from "path";
import fg from "fast-glob";
function isIdentifierCharacter(character) {
  return character !== void 0 && /[A-Za-z0-9._:/-]/.test(character);
}
function lineAndColumn(contents, offset) {
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
function buildMatchers(registry) {
  return registry.models.flatMap((model) => modelIdentifiers(model).map((identifier) => ({ identifier, model }))).sort((left, right) => right.identifier.length - left.identifier.length);
}
function findMatches(contents, matchers, ignored) {
  const candidates = [];
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
  const accepted = [];
  let occupiedUntil = -1;
  for (const candidate of candidates) {
    if (candidate.offset < occupiedUntil) continue;
    accepted.push(candidate);
    occupiedUntil = candidate.offset + candidate.identifier.length;
  }
  return accepted;
}
async function filesFor(root, config) {
  const absolute = resolve3(root);
  const info = await stat(absolute);
  if (info.isFile()) return { base: resolve3(absolute, ".."), files: [absolute] };
  if (!info.isDirectory()) throw new Error(`Scan path is not a file or directory: ${absolute}`);
  const entries = await fg(config.include, {
    cwd: absolute,
    absolute: true,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: config.exclude,
    followSymbolicLinks: false,
    suppressErrors: false
  });
  return { base: absolute, files: entries.sort() };
}
async function scanPath(options) {
  const { base, files } = await filesFor(options.root, options.config);
  const matchers = buildMatchers(options.registry);
  const ignored = new Set(options.config.ignoreModels);
  const findings = [];
  const stats = {
    filesConsidered: files.length,
    filesScanned: 0,
    filesSkipped: 0,
    bytesScanned: 0
  };
  for (const absolutePath of files) {
    const buffer = await readFile4(absolutePath);
    if (buffer.length > options.config.maxFileBytes || buffer.includes(0)) {
      stats.filesSkipped += 1;
      continue;
    }
    stats.filesScanned += 1;
    stats.bytesScanned += buffer.length;
    const contents = buffer.toString("utf8");
    const file = relative(base, absolutePath).split(sep).join("/");
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
        model: lifecycleFor(match.model, options.at, options.config.daysBeforeShutdown)
      });
    }
  }
  findings.sort(
    (left, right) => stateRank(right.model.state) - stateRank(left.model.state) || left.file.localeCompare(right.file) || left.offset - right.offset
  );
  return {
    root: isAbsolute3(options.root) ? options.root : resolve3(options.root),
    generatedAt: (options.at ?? /* @__PURE__ */ new Date()).toISOString(),
    registryUpdatedAt: options.registry.updatedAt,
    findings,
    stats
  };
}

export {
  compareModels,
  defaultConfig,
  findConfig,
  loadConfig,
  applyMigrations,
  markdownReport,
  sarifReport,
  tableReport,
  validateRegistry,
  loadBundledRegistry,
  loadRegistry,
  modelIdentifiers,
  findModel,
  lifecycleFor,
  shouldFail,
  scanPath
};
//# sourceMappingURL=chunk-TNBSS7Y4.js.map