#!/usr/bin/env node
import {
  applyMigrations,
  compareModels,
  findModel,
  lifecycleFor,
  loadConfig,
  loadRegistry,
  markdownReport,
  sarifReport,
  scanPath,
  shouldFail,
  tableReport
} from "./chunk-TNBSS7Y4.js";

// src/cli.ts
import { existsSync, statSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { Command, Option } from "commander";
function parseDate(value) {
  if (!value) return void 0;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid date: ${value}`);
  return date;
}
function render(report, format) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}
`;
  if (format === "markdown") return markdownReport(report);
  if (format === "sarif") return `${JSON.stringify(sarifReport(report), null, 2)}
`;
  return `${tableReport(report)}
`;
}
async function emit(contents, output) {
  if (!output) {
    process.stdout.write(contents);
    return;
  }
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents, "utf8");
}
async function prepare(path, options) {
  const root = resolve(path);
  const configRoot = statSync(root).isFile() ? dirname(root) : root;
  const config = loadConfig(configRoot, options.config);
  if (options.failOn) config.failOn = options.failOn;
  if (options.days !== void 0) {
    const days = Number(options.days);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error(`Invalid days value: ${options.days}`);
    config.daysBeforeShutdown = days;
  }
  const registry = await loadRegistry(options.registry, configRoot);
  const at = parseDate(options.at);
  const report = await scanPath({ root, registry, config, ...at ? { at } : {} });
  return { report, failOn: config.failOn };
}
function addCommonOptions(command) {
  return command.option("-c, --config <path>", "JSON or YAML configuration file").option("-r, --registry <path-or-url>", "custom registry JSON file or HTTPS URL").addOption(new Option("-f, --format <format>", "output format").choices(["table", "json", "markdown", "sarif"]).default("table")).option("-o, --output <path>", "write output to a file").addOption(new Option("--fail-on <level>", "failure threshold").choices(["deprecated", "retired", "never"])).option("--days <number>", "critical shutdown window in days").addOption(new Option("--at <YYYY-MM-DD>", "evaluate lifecycle state at a specific date").hideHelp());
}
var program = new Command().name("modelsunset").description("Find deprecated AI model IDs, verify replacements, and create safe migrations.").version("1.0.0").showSuggestionAfterError();
addCommonOptions(program.command("scan [path]").description("scan a file or directory").action(async (path = ".", options) => {
  const prepared = await prepare(path, options);
  await emit(render(prepared.report, options.format), options.output);
  if (shouldFail(prepared.report, prepared.failOn)) process.exitCode = 1;
}));
addCommonOptions(
  program.command("fix [path]").description("replace deprecated model IDs when the registry has one unambiguous replacement").option("--dry-run", "show what would change without writing files").option("--yes", "confirm file modifications")
).action(async (path = ".", options) => {
  const prepared = await prepare(path, options);
  await emit(render(prepared.report, options.format), options.output);
  if (!options.dryRun && !options.yes) throw new Error("Refusing to modify files without --yes (or use --dry-run)");
  const result = await applyMigrations(prepared.report, options.dryRun ?? false);
  process.stderr.write(
    `${options.dryRun ? "Would change" : "Changed"} ${result.changedFiles.length} file(s), ${result.replacements} replacement(s); ${result.skippedWithoutReplacement} manual.
`
  );
});
program.command("check <model>").description("look up one model ID").option("-r, --registry <path-or-url>", "custom registry JSON file or HTTPS URL").addOption(new Option("--at <YYYY-MM-DD>", "evaluate at a specific date").hideHelp()).action(async (identifier, options) => {
  const registry = await loadRegistry(options.registry);
  const model = findModel(registry, identifier);
  if (!model) {
    process.stdout.write(`${identifier}: no announced shutdown in registry ${registry.updatedAt}
`);
    return;
  }
  process.stdout.write(`${JSON.stringify(lifecycleFor(model, parseDate(options.at)), null, 2)}
`);
  process.exitCode = 1;
});
program.command("list").description("list all tracked model shutdowns").option("-r, --registry <path-or-url>", "custom registry JSON file or HTTPS URL").option("-p, --provider <provider>", "filter by provider").addOption(new Option("--at <YYYY-MM-DD>", "evaluate at a specific date").hideHelp()).action(async (options) => {
  const registry = await loadRegistry(options.registry);
  const models = registry.models.filter((model) => !options.provider || model.provider === options.provider).map((model) => lifecycleFor(model, parseDate(options.at))).sort((left, right) => left.shutdownAt.localeCompare(right.shutdownAt));
  process.stdout.write(`${JSON.stringify({ updatedAt: registry.updatedAt, models }, null, 2)}
`);
});
program.command("compare").description("run a project-owned adapter against old and replacement models").requiredOption("--model <id>", "deprecated model ID").requiredOption("--replacement <id>", "replacement model ID").requiredOption("--fixtures <path>", "JSON fixture file").requiredOption("--command <command>", "adapter command; receives MODELSUNSET_MODEL and MODELSUNSET_FIXTURE_JSON").option("--timeout <ms>", "per-run timeout", "60000").option("--max-latency-regression <percent>", "maximum latency regression", "50").option("--max-cost-regression <percent>", "maximum cost regression", "25").action(async (options) => {
  const results = await compareModels({
    model: options.model,
    replacement: options.replacement,
    fixturesPath: resolve(options.fixtures),
    command: options.command,
    timeoutMs: Number(options.timeout),
    maxLatencyRegressionPercent: Number(options.maxLatencyRegression),
    maxCostRegressionPercent: Number(options.maxCostRegression)
  });
  process.stdout.write(`${JSON.stringify({ passed: results.every((result) => result.passed), results }, null, 2)}
`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
});
program.command("init [path]").description("create config and GitHub workflow templates").action(async (path = ".") => {
  const root = resolve(path);
  const configPath = resolve(root, ".modelsunset.json");
  const workflowPath = resolve(root, ".github/workflows/modelsunset.yml");
  if (existsSync(configPath) || existsSync(workflowPath)) throw new Error("Refusing to overwrite existing ModelSunset files");
  await mkdir(dirname(workflowPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({ daysBeforeShutdown: 90, failOn: "deprecated", ignoreModels: [] }, null, 2)}
`,
    "utf8"
  );
  await writeFile(
    workflowPath,
    `name: ModelSunset
on:
  pull_request:
  schedule:
    - cron: '17 8 * * 1'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: broom609/model-sunset@v1
`,
    "utf8"
  );
  process.stdout.write(`Created ${configPath}
Created ${workflowPath}
`);
});
program.parseAsync().catch((error) => {
  process.stderr.write(`ModelSunset: ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 2;
});
//# sourceMappingURL=cli.js.map