# Contributing

Contributions are welcome, especially lifecycle corrections, provider coverage, language fixtures, and false-positive reductions.

## Setup

```bash
git clone https://github.com/broom609/model-sunset.git
cd model-sunset
npm ci
npm run check
```

Node.js 20 or newer is required.

## Registry changes

Every model entry must include:

1. The exact provider model ID.
2. A valid shutdown date from an official provider lifecycle page.
3. The provider-recommended replacement, when one exists.
4. A note when the date is tentative or represents the earliest possible shutdown.

Update `registry.updatedAt` and include the official source in the pull-request description. Do not infer retirement dates from release age, news articles, or third-party trackers.

## Pull requests

- Keep changes focused.
- Add a failing test before fixing scanner or migration behavior.
- Run `npm run check`.
- Do not commit credentials, provider responses, or proprietary fixtures.
- Include `dist/` changes when action source changes; CI verifies that the committed bundle is reproducible.

By contributing, you agree that your contribution is licensed under the MIT License.
