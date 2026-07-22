import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as core from '@actions/core';
import { exec } from '@actions/exec';
import { context, getOctokit } from '@actions/github';
import { loadConfig } from './config.js';
import { createOrUpdatePullRequest } from './github-pr.js';
import { applyMigrations } from './migrate.js';
import { markdownReport, sarifReport } from './reporters/index.js';
import { loadRegistry } from './registry.js';
import { scanPath } from './scanner.js';
import { shouldFail } from './status.js';
import type { FailOn } from './types.js';

function input(name: string): string | undefined {
  return core.getInput(name).trim() || undefined;
}

function booleanInput(name: string): boolean {
  return (input(name) ?? 'false').toLowerCase() === 'true';
}

function failOnInput(value: string | undefined): FailOn {
  if (value === 'deprecated' || value === 'retired' || value === 'never') return value;
  throw new Error(`Invalid fail-on value: ${value ?? '(empty)'}`);
}

async function defaultBranch(token: string): Promise<string> {
  const octokit = getOctokit(token);
  const repository = await octokit.rest.repos.get(context.repo);
  return repository.data.default_branch;
}

async function run(): Promise<void> {
  const root = resolve(input('path') ?? '.');
  const configRoot = statSync(root).isFile() ? dirname(root) : root;
  const config = loadConfig(configRoot, input('config'));
  config.failOn = failOnInput(input('fail-on') ?? config.failOn);
  const days = Number(input('days') ?? config.daysBeforeShutdown);
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error(`Invalid days value: ${days}`);
  config.daysBeforeShutdown = days;

  const registry = await loadRegistry(input('registry'), configRoot);
  const report = await scanPath({ root, registry, config });
  const sarifPath = resolve(root, 'modelsunset.sarif');
  await writeFile(sarifPath, `${JSON.stringify(sarifReport(report), null, 2)}\n`, 'utf8');
  core.setOutput('findings', report.findings.length);
  core.setOutput('sarif-path', sarifPath);
  await core.summary.addRaw(markdownReport(report)).write();

  for (const finding of report.findings.slice(0, 50)) {
    core.warning(
      `${finding.matchedId} shuts down ${finding.model.shutdownAt}; replacement: ${finding.model.replacement ?? 'manual migration required'}`,
      { file: finding.file, startLine: finding.line, startColumn: finding.column },
    );
  }

  const mode = input('mode') ?? 'scan';
  if (mode !== 'scan' && mode !== 'pr') throw new Error(`Invalid mode: ${mode}`);
  if (mode === 'scan') {
    if (shouldFail(report, config.failOn)) core.setFailed(`${report.findings.length} deprecated model reference(s) found`);
    return;
  }

  const token = input('github-token');
  if (!token) throw new Error('github-token is required when mode is pr');
  const migration = await applyMigrations(report, false);
  core.setOutput('migrations', migration.changedFiles.length);
  if (migration.changedFiles.length === 0) {
    if (report.findings.length > 0) core.setFailed('Findings require manual migration; no safe replacements were available');
    return;
  }

  const verifyCommand = input('verify-command');
  if (verifyCommand) {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellArguments = process.platform === 'win32' ? ['/d', '/s', '/c', verifyCommand] : ['-c', verifyCommand];
    const exitCode = await exec(shell, shellArguments, { cwd: root });
    if (exitCode !== 0) throw new Error(`Verification command failed with exit code ${exitCode}`);
  }

  const base = input('base-branch') ?? (await defaultBranch(token));
  const body = [
    '## Automated model migration',
    '',
    `ModelSunset replaced ${migration.replacements} deprecated model reference(s) across ${migration.changedFiles.length} file(s).`,
    '',
    markdownReport(report),
    '## Verification',
    '',
    verifyCommand ? `Passed: \`${verifyCommand.replaceAll('`', '\\`')}\`` : 'No verification command was configured.',
    '',
    '> Automated model-ID replacement does not prove behavioral equivalence. Review provider migration guidance and application output before merging.',
  ].join('\n');
  const url = await createOrUpdatePullRequest({
    token,
    ...context.repo,
    cwd: root,
    base,
    branch: input('branch') ?? 'modelsunset/automated-migrations',
    title: 'Migrate deprecated AI models',
    body,
    changedFiles: migration.changedFiles,
    draft: booleanInput('draft'),
  });
  core.setOutput('pr-url', url);
  core.notice(`Migration pull request: ${url}`);
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
