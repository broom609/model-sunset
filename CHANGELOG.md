# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## Unreleased

- Refreshed the lifecycle registry against all three provider deprecation pages (2026-09-28).
- OpenAI: replacements now point to the GPT-5.6 family (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`); added `gpt-5.4-cyber`, the transcription deprecations (`whisper-1`, `gpt-4o-transcribe` and variants), `o1-pro`, `gpt-4-1106-preview`, `gpt-5.2-codex`, and the October 2025 audio/realtime mini snapshots. GPT Image and transcription entries list both provider-recommended replacements and require a manual choice.
- Google: removed the withdrawn shutdown dates for `gemini-2.5-pro`, `gemini-2.5-flash`, and `gemini-2.5-flash-lite`, which were being reported as shutting down on 2026-10-16. Moved `gemini-embedding-001` to 2028-05-14. Added Veo 2/3, Imagen 4 preview, Gemini 2.5 preview, `gemini-omni-flash-preview`, and `gemini-robotics-er-1.6-preview`.
- Anthropic: removed `claude-mythos-preview`, whose retirement date is now "to be announced".

## 1.0.0 - 2026-07-22

- Added local scanning for OpenAI, Anthropic, and Google Gemini API model IDs.
- Added table, JSON, Markdown, and SARIF reports.
- Added configurable failure thresholds, exclusions, ignores, and custom registries.
- Added guarded exact-ID migrations and idempotent GitHub migration pull requests.
- Added provider-neutral old/new model comparison through project-owned adapters.
- Added strict registry validation, security limits, CI, coverage gates, and distribution verification.
