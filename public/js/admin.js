'use strict';

const adminMenuToggle = document.querySelector('[data-admin-menu-toggle]');
const adminNavigation = document.querySelector('[data-admin-navigation]');

if (adminMenuToggle && adminNavigation) {
  const closeAdminMenu = (returnFocus = false) => {
    adminNavigation.classList.remove('is-open');
    adminMenuToggle.classList.remove('is-open');
    adminMenuToggle.setAttribute('aria-expanded', 'false');
    adminMenuToggle.setAttribute('aria-label', 'Ouvrir la navigation d’administration');
    if (returnFocus) adminMenuToggle.focus();
  };
  adminMenuToggle.addEventListener('click', () => {
    const open = adminNavigation.classList.toggle('is-open');
    adminMenuToggle.classList.toggle('is-open', open);
    adminMenuToggle.setAttribute('aria-expanded', String(open));
    adminMenuToggle.setAttribute('aria-label', open ? 'Fermer la navigation d’administration' : 'Ouvrir la navigation d’administration');
    if (open) adminNavigation.querySelector('a')?.focus();
  });
  adminNavigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeAdminMenu()));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && adminNavigation.classList.contains('is-open')) closeAdminMenu(true); });
  document.addEventListener('click', (event) => {
    if (adminNavigation.classList.contains('is-open') && !adminNavigation.contains(event.target) && !adminMenuToggle.contains(event.target)) closeAdminMenu();
  });
  window.addEventListener('resize', () => { if (window.innerWidth > 768) closeAdminMenu(); });
}
