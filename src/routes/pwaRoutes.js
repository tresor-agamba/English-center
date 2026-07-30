const express = require('express');
const path = require('path');
const settingsService = require('../services/centerSettingsService');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
const publicRoot = path.resolve(__dirname, '..', '..', 'public');

router.get('/manifest.webmanifest', asyncHandler(async (req, res) => {
  const settings = await settingsService.getPublicCenterSettings();
  const name = 'New Vision Academy';
  const shortName = 'NVA';
  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  res.json({
    id: '/',
    name,
    short_name: shortName.slice(0, 30),
    description: settings.description || 'Live online language programs for personal and professional growth.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F7F9FC',
    theme_color: '#17105C',
    lang: settings.primaryLanguage || 'fr',
    categories: ['education', 'productivity'],
    icons: [
      ...[72, 96, 128, 144, 152, 192, 384, 512].map((size) => ({
        src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any',
      })),
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Se connecter', short_name: 'Connexion', url: '/login', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Formations', short_name: 'Formations', url: '/formations', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  });
}));

router.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile('sw.js', { root: publicRoot, dotfiles: 'deny' });
});

router.get('/offline', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile('offline.html', { root: publicRoot, dotfiles: 'deny' });
});

module.exports = router;
