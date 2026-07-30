(() => {
  'use strict';
  const isTest = document.documentElement.dataset.environment === 'test';
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  document.documentElement.classList.toggle('pwa-standalone', isStandalone);

  const announce = (message, actionLabel, action) => {
    const region = document.querySelector('[data-pwa-messages]');
    if (!region) return;
    region.hidden = false;
    region.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    region.append(text);
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-small';
      button.textContent = actionLabel;
      button.addEventListener('click', action);
      region.append(button);
    }
  };
  const translate = (key) => {
    const language = window.GLI_I18N?.language || 'en';
    return window.GLI_I18N?.translations[language]?.[key] || key;
  };

  if (!navigator.onLine) announce(translate('pwa.offline'));
  window.addEventListener('offline', () => announce(translate('pwa.offline')));
  document.addEventListener('gli:languagechange', () => {
    if (!navigator.onLine) announce(translate('pwa.offline'));
  });
  window.addEventListener('online', () => {
    const region = document.querySelector('[data-pwa-messages]');
    if (region) region.hidden = true;
  });
  document.addEventListener('submit', (event) => {
    if (!navigator.onLine) {
      event.preventDefault();
      announce(translate('pwa.requiresInternet'));
    }
  });

  let deferredInstallPrompt;
  const installButton = document.querySelector('[data-pwa-install]');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installButton && !isStandalone) installButton.hidden = false;
  });
  installButton?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
  });

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const iosHelp = document.querySelector('[data-pwa-ios-help]');
  if (iosHelp && isIos && !isStandalone && localStorage.getItem('pwa-ios-help-dismissed') !== '1') iosHelp.hidden = false;
  document.querySelector('[data-pwa-ios-dismiss]')?.addEventListener('click', () => {
    localStorage.setItem('pwa-ios-help-dismissed', '1');
    iosHelp.hidden = true;
  });

  if (!('serviceWorker' in navigator) || isTest) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const offerUpdate = (worker) => announce(translate('pwa.updateAvailable'), translate('pwa.update'), () => worker.postMessage({ type: 'SKIP_WAITING' }));
      if (registration.waiting) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        if (!document.querySelector('form:focus-within')) window.location.reload();
        else announce(translate('pwa.updateReady'), translate('pwa.reload'), () => window.location.reload());
      });
    } catch (error) {
      if (document.documentElement.dataset.environment === 'development') console.warn('Service worker non enregistré.', error);
    }
  });
})();
