// Replace this deterministic example with your own provider SDK call.
const fixture = JSON.parse(process.env.MODELSUNSET_FIXTURE_JSON);
const model = process.env.MODELSUNSET_MODEL;

process.stdout.write(JSON.stringify({
  output: {
    model,
    category: fixture.message.includes('sign in') ? 'account_access' : 'other',
  },
  costUsd: 0,
}));
