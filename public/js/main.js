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
    document.querySelectorAll('[data-center-phone-link]').forEach((node) => {
      if (!settings.primaryPhone) return;
      node.hidden = false; node.href = `tel:${settings.primaryPhone.replace(/[^\d+]/g, '')}`;
    });
    const location = [settings.city, settings.country].filter(Boolean).join(', ');
    document.querySelectorAll('[data-center-location]').forEach((node) => {
      if (!location) return;
      node.hidden = false; node.textContent = location;
    });
    document.querySelectorAll('[data-contact-email]').forEach((node) => { node.hidden = !settings.email; });
    document.querySelectorAll('[data-contact-phone]').forEach((node) => { node.hidden = !settings.primaryPhone; });
    document.querySelectorAll('[data-contact-location]').forEach((node) => { node.hidden = !location; });
    document.querySelectorAll('[data-contact-empty]').forEach((node) => {
      node.hidden = Boolean(settings.email || settings.primaryPhone || location);
    });
    const whatsapp = document.querySelector('[data-whatsapp-contact]');
    const whatsappLink = whatsapp?.querySelector('[data-whatsapp-link]');
    if (whatsapp && whatsappLink && settings.publicWhatsAppNumber) {
      const updateWhatsAppLink = () => {
        const language = window.GLI_I18N?.language || 'en';
        const dictionary = window.GLI_I18N?.translations[language] || {};
        const message = dictionary['whatsapp.message'] || 'Hello, I would like more information about New Vision Academy courses.';
        whatsappLink.href = `https://wa.me/${settings.publicWhatsAppNumber}?text=${encodeURIComponent(message)}`;
      };
      updateWhatsAppLink();
      document.addEventListener('gli:languagechange', updateWhatsAppLink);
      whatsapp.hidden = false;
    }
  })
  .catch(() => {});

const menuToggle = document.querySelector('[data-menu-toggle]');
const navigation = document.querySelector('[data-public-navigation]');
if (navigation) {
  const currentPath = window.location.pathname;
  navigation.querySelectorAll('a[href]').forEach((link) => {
    const linkPath = new URL(link.href, window.location.origin).pathname;
    const active = linkPath === '/'
      ? currentPath === '/'
      : currentPath === linkPath || currentPath.startsWith(`${linkPath}/`);
    if (active) link.setAttribute('aria-current', 'page');
  });
}
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

document.querySelectorAll('[data-faq-button]').forEach((button) => {
  button.addEventListener('click', () => {
    const faq = button.closest('[data-faq]');
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const willOpen = button.getAttribute('aria-expanded') !== 'true';
    faq.querySelectorAll('[data-faq-button]').forEach((other) => {
      other.setAttribute('aria-expanded', 'false');
      const otherPanel = document.getElementById(other.getAttribute('aria-controls'));
      if (otherPanel) otherPanel.hidden = true;
    });
    button.setAttribute('aria-expanded', String(willOpen));
    if (panel) panel.hidden = !willOpen;
  });
});

document.querySelectorAll('.certificate-search').forEach((form) => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (button && form.checkValidity()) button.setAttribute('aria-busy', 'true');
  });
});

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
  const courseSelect = registrationForm.querySelector('[data-register-course]');
  const sessionSummary = registrationForm.querySelector('[data-register-session]');
  const updateRegistrationSession = () => {
    if (!courseSelect || !sessionSummary) return;
    const option = courseSelect.selectedOptions[0];
    const name = sessionSummary.querySelector('[data-register-session-name]');
    const date = sessionSummary.querySelector('[data-register-session-date]');
    const language = window.GLI_I18N?.language || 'en';
    const dictionary = window.GLI_I18N?.translations[language] || {};
    if (!option?.value) {
      name.textContent = dictionary['register.session.choose'] || 'Choose a course first';
      date.hidden = true; return;
    }
    name.textContent = option.dataset.sessionName || dictionary['register.session.available'] || 'Next eligible session';
    if (option.dataset.sessionStart) {
      date.setAttribute('datetime', option.dataset.sessionStart); date.hidden = false;
      const parsed = new Date(option.dataset.sessionStart);
      date.textContent = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'long' }).format(parsed);
    } else date.hidden = true;
  };
  courseSelect?.addEventListener('change', updateRegistrationSession);
  document.addEventListener('gli:languagechange', updateRegistrationSession);
  updateRegistrationSession();
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
  const durationUnits = {
    en: { HOURS: ['hour', 'hours'], DAYS: ['day', 'days'], WEEKS: ['week', 'weeks'], MONTHS: ['month', 'months'] },
    fr: { HOURS: ['heure', 'heures'], DAYS: ['jour', 'jours'], WEEKS: ['semaine', 'semaines'], MONTHS: ['mois', 'mois'] },
  };
  document.querySelectorAll('[data-local-duration]').forEach((node) => {
    const value = Number(node.dataset.value); const labels = durationUnits[language][node.dataset.unit];
    if (Number.isFinite(value) && labels) node.textContent = `${value} ${value > 1 ? labels[1] : labels[0]}`;
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

const courseCatalog = document.querySelector('[data-course-catalog]');
if (courseCatalog) {
  const input = courseCatalog.querySelector('[data-course-search-input]');
  const filters = [...courseCatalog.querySelectorAll('[data-course-category-filter]')];
  const cards = [...courseCatalog.querySelectorAll('[data-public-course-card]')];
  const noResults = courseCatalog.querySelector('[data-course-no-results]');
  let category = 'ALL';
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const update = () => {
    const query = normalize(input?.value || ''); let visible = 0;
    cards.forEach((card) => {
      const matchesCategory = category === 'ALL' || card.dataset.courseCategory === category;
      const matchesQuery = !query || normalize(`${card.dataset.courseSearch} ${card.textContent}`).includes(query);
      card.hidden = !(matchesCategory && matchesQuery); if (!card.hidden) visible += 1;
    });
    if (noResults) noResults.hidden = visible !== 0;
  };
  input?.addEventListener('input', update);
  filters.forEach((button) => button.addEventListener('click', () => {
    category = button.dataset.courseCategoryFilter;
    filters.forEach((item) => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); });
    update();
  }));
}

const loginPassword = document.querySelector('[data-login-password]');
const loginPasswordToggle = document.querySelector('[data-password-toggle]');
if (loginPassword && loginPasswordToggle) {
  const updatePasswordToggle = () => {
    const visible = loginPassword.type === 'text';
    const language = window.GLI_I18N?.language || 'en';
    const dictionary = window.GLI_I18N?.translations[language] || {};
    loginPasswordToggle.textContent = dictionary[visible ? 'login.password.hide' : 'login.password.show'] || (visible ? 'Hide' : 'Show');
    loginPasswordToggle.setAttribute('aria-pressed', String(visible));
    loginPasswordToggle.setAttribute('aria-label', loginPasswordToggle.textContent);
  };
  loginPasswordToggle.addEventListener('click', () => {
    const start = loginPassword.selectionStart; const end = loginPassword.selectionEnd;
    loginPassword.type = loginPassword.type === 'password' ? 'text' : 'password';
    loginPassword.focus();
    if (start !== null && end !== null) loginPassword.setSelectionRange(start, end);
    updatePasswordToggle();
  });
  document.addEventListener('gli:languagechange', updatePasswordToggle);
  updatePasswordToggle();
}
