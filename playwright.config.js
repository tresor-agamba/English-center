const { defineConfig } = require('@playwright/test');
const responsivePort = process.env.PLAYWRIGHT_PORT || '3100';
module.exports = defineConfig({
  testDir: './tests/responsive', timeout: 10 * 60 * 1000, workers: 1, fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${responsivePort}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/responsiveTestServer.js', url: `http://127.0.0.1:${responsivePort}/health`, timeout: 120000, reuseExistingServer: false, env: { ...process.env, PORT: responsivePort, NODE_ENV: 'test', PUBLIC_WHATSAPP_NUMBER: '243899999999' } },
  outputDir: 'test-results/responsive/artifacts',
});
