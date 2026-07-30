document.documentElement.classList.add('js-enabled');

fetch('/settings/public', { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : null)
  .then((settings) => {
    if (!settings) return;
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
    const lang = window.GLI_I18N?.language || 'en';
    menuToggle.setAttribute('aria-label', window.GLI_I18N?.translations[lang]?.['nav.open'] || 'Open menu');
  };
  menuToggle.addEventListener('click', () => {
    const open = navigation.classList.toggle('is-open');
    menuToggle.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    const lang = window.GLI_I18N?.language || 'en';
    menuToggle.setAttribute('aria-label', window.GLI_I18N?.translations[lang]?.[open ? 'nav.close' : 'nav.open'] || (open ? 'Close menu' : 'Open menu'));
  });
  navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  document.addEventListener('click', (event) => {
    if (navigation.classList.contains('is-open') && !navigation.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 900) closeMenu(); });
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

const localizePublicValues = () => {
  const language = window.GLI_I18N?.language || 'en';
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  document.querySelectorAll('[data-local-date]').forEach((node) => {
    const date = new Date(node.getAttribute('datetime'));
    if (!Number.isNaN(date.getTime())) node.textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
  });
  document.querySelectorAll('[data-local-price]').forEach((node) => {
    const amount = Number(node.dataset.amount);
    if (Number.isFinite(amount)) node.textContent = new Intl.NumberFormat(locale, { style: 'currency', currency: node.dataset.currency }).format(amount);
  });
  const weekDays = {
    en: { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' },
    fr: { MONDAY: 'lundi', TUESDAY: 'mardi', WEDNESDAY: 'mercredi', THURSDAY: 'jeudi', FRIDAY: 'vendredi', SATURDAY: 'samedi', SUNDAY: 'dimanche' },
  };
  document.querySelectorAll('[data-week-days]').forEach((node) => {
    const values = node.dataset.weekDays.split(',').filter(Boolean).map((day) => weekDays[language][day] || day);
    node.textContent = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(values);
  });
};
document.addEventListener('gli:languagechange', localizePublicValues);
document.addEventListener('DOMContentLoaded', localizePublicValues);
