document.documentElement.classList.add('js-enabled');
fetch('/settings/public', { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : null)
  .then((settings) => {
    if (!settings) return;
    document.documentElement.style.setProperty('--primary', settings.primaryColor || '#1D4ED8');
    document.documentElement.style.setProperty('--secondary', settings.secondaryColor || '#173B57');
    document.documentElement.style.setProperty('--accent', settings.accentColor || '#C9A95E');
    document.querySelectorAll('[data-center-name]').forEach((node) => { node.textContent = settings.shortName || settings.officialName; });
    if (settings.mainLogoUrl) {
      const brand = document.querySelector('.brand');
      if (brand && !brand.querySelector('img')) {
        const image = document.createElement('img');
        image.src = settings.mainLogoUrl; image.alt = ''; image.className = 'brand-logo';
        brand.prepend(image);
      }
    }
  })
  .catch(() => {});

const registrationForm = document.querySelector('[data-public-registration-form]');
if (registrationForm) {
  const level = registrationForm.querySelector('[data-requested-level]');
  const submit = registrationForm.querySelector('[data-registration-submit]');
  const updateLevelGuidance = () => {
    const needsTest = ['LEVEL_2', 'LEVEL_3'].includes(level.value);
    registrationForm.querySelectorAll('[data-level-message]').forEach((node) => {
      node.hidden = node.dataset.levelMessage !== level.value;
    });
    submit.textContent = needsTest ? 'Créer mon compte et passer le test' : 'Créer mon compte';
  };
  level.addEventListener('change', updateLevelGuidance);
  updateLevelGuidance();
}
