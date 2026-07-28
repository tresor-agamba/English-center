const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/pwa',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/pwa/playwright-report.json' }]],
  use: { baseURL: 'http://127.0.0.1:3200', browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:3200/health',
    timeout: 120_000,
    reuseExistingServer: true,
    env: { ...process.env, PORT: '3200', NODE_ENV: 'development' },
  },
  outputDir: 'test-results/pwa/artifacts',
});
