import { getExecOutput, exec } from '@actions/exec';
import { getOctokit } from '@actions/github';
import { relative, resolve, sep } from 'node:path';

export interface PullRequestOptions {
  token: string;
  owner: string;
  repo: string;
  cwd: string;
  base: string;
  branch: string;
  title: string;
  body: string;
  changedFiles: string[];
  draft: boolean;
}

function assertSafeBranch(branch: string, base: string): void {
  if (branch === base) throw new Error('Migration branch must not be the base branch');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.endsWith('/')) {
    throw new Error(`Unsafe migration branch name: ${branch}`);
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  const code = await exec('git', args, { cwd });
  if (code !== 0) throw new Error(`git ${args[0] ?? ''} failed with exit code ${code}`);
}

export async function createOrUpdatePullRequest(options: PullRequestOptions): Promise<string> {
  assertSafeBranch(options.branch, options.base);
  if (options.changedFiles.length === 0) throw new Error('No changed files to publish');

  const topLevelOutput = await getExecOutput('git', ['rev-parse', '--show-toplevel'], { cwd: options.cwd, silent: true });
  if (topLevelOutput.exitCode !== 0) throw new Error('PR mode requires a Git checkout');
  const gitRoot = topLevelOutput.stdout.trim();
  const expected = options.changedFiles
    .map((file) => relative(gitRoot, resolve(options.cwd, file)).split(sep).join('/'))
    .sort();
  if (expected.some((file) => file === '..' || file.startsWith('../'))) {
    throw new Error('Refusing to publish a migrated file outside the Git repository');
  }

  await git(gitRoot, ['config', 'user.name', 'modelsunset[bot]']);
  await git(gitRoot, ['config', 'user.email', 'modelsunset[bot]@users.noreply.github.com']);
  await git(gitRoot, ['checkout', '-B', options.branch]);
  await git(gitRoot, ['add', '--', ...expected]);
  const staged = await getExecOutput('git', ['diff', '--cached', '--name-only'], { cwd: gitRoot, silent: true });
  const stagedFiles = staged.stdout.trim().split('\n').filter(Boolean).sort();
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expected)) {
    throw new Error(`Refusing to publish unexpected files. Expected ${expected.join(', ')}; staged ${stagedFiles.join(', ')}`);
  }
  await git(gitRoot, ['commit', '-m', 'Migrate deprecated AI models']);
  await git(gitRoot, ['push', '--force', 'origin', `HEAD:refs/heads/${options.branch}`]);

  const octokit = getOctokit(options.token);
  const existing = await octokit.rest.pulls.list({
    owner: options.owner,
    repo: options.repo,
    base: options.base,
    head: `${options.owner}:${options.branch}`,
    state: 'open',
    per_page: 10,
  });
  const pull = existing.data[0];
  if (pull) {
    const updated = await octokit.rest.pulls.update({
      owner: options.owner,
      repo: options.repo,
      pull_number: pull.number,
      title: options.title,
      body: options.body,
    });
    return updated.data.html_url;
  }

  const created = await octokit.rest.pulls.create({
    owner: options.owner,
    repo: options.repo,
    base: options.base,
    head: options.branch,
    title: options.title,
    body: options.body,
    draft: options.draft,
  });
  return created.data.html_url;
}
