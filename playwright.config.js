const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/responsive', timeout: 10 * 60 * 1000, workers: 1, fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/responsive/playwright-report.json' }]],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node src/server.js', url: 'http://127.0.0.1:3100/health', timeout: 120000, reuseExistingServer: true, env: { ...process.env, PORT: '3100', NODE_ENV: 'test' } },
  outputDir: 'test-results/responsive/artifacts',
});
