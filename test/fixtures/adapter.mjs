const fixture = JSON.parse(process.env.MODELSUNSET_FIXTURE_JSON);
const model = process.env.MODELSUNSET_MODEL;

process.stdout.write(JSON.stringify({
  output: {
    category: 'account_access',
    source: fixture.message,
  },
  costUsd: model === 'old-model' ? 0.01 : 0.011,
}));
