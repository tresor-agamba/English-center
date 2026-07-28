document.documentElement.classList.add('js-enabled');

fetch('/settings/public', { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : null)
  .then((settings) => {
    if (!settings) return;
    document.documentElement.style.setProperty('--primary', settings.primaryColor || '#2563EB');
    document.documentElement.style.setProperty('--secondary', settings.secondaryColor || '#0F172A');
    document.documentElement.style.setProperty('--accent', settings.accentColor || '#F59E0B');
    if (settings.mainLogoUrl) {
      document.querySelectorAll('.gli-brand').forEach((brand) => {
        if (brand.querySelector('img')) return;
        const image = document.createElement('img');
        image.src = settings.mainLogoUrl; image.alt = ''; image.className = 'brand-logo';
        brand.querySelector('.brand-mark')?.replaceWith(image);
      });
    }
    document.querySelectorAll('[data-center-email]').forEach((node) => {
      if (!settings.email) return;
      node.hidden = false; node.textContent = settings.email; node.href = `mailto:${settings.email}`;
    });
    document.querySelectorAll('[data-center-phone]').forEach((node) => {
      if (!settings.primaryPhone) return;
      node.hidden = false; node.textContent = settings.primaryPhone;
    });
  })
  .catch(() => {});

const menuToggle = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-public-navigation]');
if (menuToggle && navigation) {
  const closeMenu = () => {
    navigation.classList.remove('is-open'); menuToggle.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };
  menuToggle.addEventListener('click', () => {
    const open = navigation.classList.toggle('is-open');
    menuToggle.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
}

const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: 0.12 })
  : null;
document.querySelectorAll('.reveal').forEach((node) => observer ? observer.observe(node) : node.classList.add('is-visible'));

const registrationForm = document.querySelector('[data-public-registration-form]');
if (registrationForm) {
  const level = registrationForm.querySelector('[data-requested-level]');
  const submit = registrationForm.querySelector('[data-registration-submit]');
  const updateLevelGuidance = () => {
    const needsTest = ['LEVEL_2', 'LEVEL_3'].includes(level.value);
    registrationForm.querySelectorAll('[data-level-message]').forEach((node) => {
      node.hidden = node.dataset.levelMessage !== level.value;
    });
    const lang = window.GLI_I18N?.language || 'en';
    submit.textContent = window.GLI_I18N?.translations[lang][needsTest ? 'form.createTest' : 'form.create']
      || (needsTest ? 'Create My Account and Take the Test' : 'Create My Account');
  };
  level.addEventListener('change', updateLevelGuidance);
  document.addEventListener('gli:languagechange', updateLevelGuidance);
  updateLevelGuidance();
}
