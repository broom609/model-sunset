# ModelSunset

**Catch retired AI models before production does.**

ModelSunset scans source code and configuration for model IDs with announced shutdown dates, explains the replacement, and can open a reviewable migration pull request. It supports OpenAI, Anthropic, and the Google Gemini API without requiring an API key.

[![CI](https://github.com/broom609/model-sunset/actions/workflows/ci.yml/badge.svg)](https://github.com/broom609/model-sunset/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933)](package.json)

```text
$ npx model-sunset scan .

STATE     MODEL                          REPLACEMENT          SHUTDOWN    LOCATION
────────  ─────────────────────────────  ───────────────────  ──────────  ─────────────────────
RETIRED   gemini-embedding-001           gemini-embedding-2   2026-07-14  src/embeddings.ts:8:17
CRITICAL  claude-opus-4-1-20250805       claude-opus-4-8      2026-08-05  api/agent.py:42:13

2 reference(s) in 2 file(s). Registry: 2026-07-22.
```

## Why ModelSunset

Model shutdowns are operational failures waiting for a date. Provider emails show that an account used a model, but they do not tell a team which repository, environment file, deployment manifest, example, or test fixture still contains it.

ModelSunset provides:

- **Exact source locations** across TypeScript, JavaScript, Python, Go, Java, Ruby, PHP, Rust, Terraform, YAML, JSON, Markdown, shell, and environment files.
- **Lifecycle-aware severity**: deprecated, critical, or retired, evaluated in UTC.
- **Curated replacements** linked to official provider lifecycle pages.
- **Safe codemods** that only replace exact registered identifiers with one unambiguous replacement.
- **GitHub annotations and SARIF** for code-scanning workflows.
- **Idempotent migration PRs** on a dedicated branch, optionally gated by your test command.
- **Provider-neutral comparison** through a project-owned adapter, so credentials never go to ModelSunset.
- **Deterministic CI** using a bundled registry, plus custom local or HTTPS registries when needed.

## Quick start

Install the CLI directly from the versioned GitHub release line:

```bash
npm install --global https://github.com/broom609/model-sunset/releases/download/v1.0.0/model-sunset-1.0.0.tgz
modelsunset scan .
```

Or keep it project-local:

```bash
npm install --save-dev https://github.com/broom609/model-sunset/releases/download/v1.0.0/model-sunset-1.0.0.tgz
npx modelsunset scan .
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Clean, or findings are below the configured failure threshold |
| `1` | Findings meet the failure threshold or a comparison failed |
| `2` | Invalid configuration, arguments, registry, or runtime error |

## GitHub Action: scan pull requests

```yaml
name: ModelSunset

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
        with:
          fail-on: deprecated
          days: '90'
```

The action writes `modelsunset.sarif`. To upload it to GitHub code scanning, add:

```yaml
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: modelsunset.sarif
```

## GitHub Action: open migration pull requests

Use PR mode on a schedule or through `workflow_dispatch`. ModelSunset never writes to the default branch; it pushes a dedicated migration branch and opens or updates one pull request.

```yaml
name: Model migration

on:
  schedule:
    - cron: '17 8 * * 1'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: broom609/model-sunset@v1
        with:
          mode: pr
          github-token: ${{ secrets.GITHUB_TOKEN }}
          verify-command: npm test
          draft: 'true'
```

Safety rules:

1. Only exact registered model identifiers are changed.
2. Models without one provider-recommended replacement are reported but never rewritten.
3. Only files reported as migrated are staged.
4. The migration branch cannot equal the base branch.
5. The optional verification command must pass before anything is pushed.
6. The pull request stays a draft by default because model behavior can change even when APIs are compatible.

## CLI commands

### Scan

```bash
modelsunset scan [path] \
  --format table|json|markdown|sarif \
  --fail-on deprecated|retired|never \
  --days 90 \
  --output report.sarif
```

### Preview or apply replacements

```bash
# Never writes files
modelsunset fix . --dry-run

# Explicit confirmation is required
modelsunset fix . --yes
```

### Check one model

```bash
modelsunset check claude-opus-4-1-20250805
```

### List the registry

```bash
modelsunset list --provider openai
```

### Initialize another repository

```bash
modelsunset init .
```

This creates `.modelsunset.json` and `.github/workflows/modelsunset.yml` without overwriting existing files.

## Compare old and replacement behavior

ModelSunset deliberately does not collect provider keys or assume a particular SDK. Instead, it runs a command owned by your project twice per fixture. The command receives:

- `MODELSUNSET_MODEL`: the old or replacement model ID
- `MODELSUNSET_FIXTURE_JSON`: the current fixture input as JSON

It must print one JSON object:

```json
{
  "output": {
    "category": "account_access",
    "confidence": 0.98
  },
  "costUsd": 0.0012,
  "usage": {
    "inputTokens": 120,
    "outputTokens": 30
  }
}
```

Run the comparison:

```bash
modelsunset compare \
  --model claude-opus-4-1-20250805 \
  --replacement claude-opus-4-8 \
  --fixtures examples/fixtures.json \
  --command 'node examples/adapter.mjs' \
  --max-latency-regression 50 \
  --max-cost-regression 25
```

ModelSunset compares successful execution, JSON structure, observed latency, and reported cost. Semantic quality remains application-specific and should be covered by assertions inside your adapter or existing evaluation suite.

## Configuration

`.modelsunset.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/broom609/model-sunset/main/modelsunset.schema.json",
  "include": ["src/**/*.{ts,tsx,py}", "deploy/**/*.{yaml,yml}"],
  "exclude": ["src/generated/**"],
  "ignoreModels": ["gpt-4"],
  "daysBeforeShutdown": 90,
  "failOn": "deprecated",
  "maxFileBytes": 2097152
}
```

JSON, YAML, and YML configuration files are supported. Default exclusions cover dependency, build, coverage, virtual-environment, lock, and Git metadata directories. Symbolic links are not followed, binary files are skipped, and individual files are capped at 2 MiB by default.

## Registry and data policy

The bundled registry is located at [`registry/models.json`](registry/models.json). Every entry includes a shutdown date, provider, official source, and optional replacement. Registry validation rejects:

- unknown providers;
- duplicate IDs or aliases;
- malformed dates;
- deprecation dates after shutdown dates;
- replacements that point back to the deprecated ID.

Authoritative sources:

- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

Google publishes some dates as the *earliest possible* shutdown. Those entries retain that qualification in the registry note.

Use a custom registry without modifying ModelSunset:

```bash
modelsunset scan . --registry ./company-model-registry.json
modelsunset scan . --registry https://example.com/model-registry.json
```

Remote registries must use HTTPS, return valid JSON, finish within 10 seconds, and remain under 5 MiB.

## Limitations

- Static scanning cannot see model IDs assembled entirely at runtime or stored only in an external secret manager.
- A provider-recommended replacement is not proof of behavioral equivalence.
- ModelSunset does not send source code, environment variables, fixtures, or credentials anywhere. A custom HTTPS registry is the only optional network request made by the CLI.
- Registry data can change between releases. Verify important migrations against the linked provider documentation.

## Development

```bash
npm ci
npm run check
```

`npm run check` runs linting, strict TypeScript checks, coverage-enforced tests, both production builds, and a clean end-to-end distribution test.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
