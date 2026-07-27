(() => {
  const forms = [...document.querySelectorAll('.written-response-form')];
  const progress = document.querySelector('#written-progress');
  const status = document.querySelector('#written-status');
  const submitForm = document.querySelector('#written-submit');
  const timer = document.querySelector('#written-timer');
  let submitting = false;
  function refresh() {
    const answered = forms.filter(form => [...new FormData(form).values()].some(value => String(value).trim())).length;
    if (progress) progress.style.width = `${forms.length ? answered / forms.length * 100 : 0}%`;
    if (status) status.textContent = `${answered} réponse(s) renseignée(s) sur ${forms.length}`;
  }
  async function save(form) {
    const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('SAVE_FAILED');
    refresh();
  }
  forms.forEach(form => {
    let timeout;
    form.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => save(form).catch(() => { if (status) status.textContent = 'Échec de sauvegarde. Réessayez.'; }), 500);
    });
    form.addEventListener('submit', event => { event.preventDefault(); save(form).catch(() => {}); });
  });
  function tick() {
    if (!timer?.dataset.expires) return;
    const remaining = new Date(timer.dataset.expires).getTime() - Date.now();
    if (remaining <= 0) {
      timer.textContent = 'Temps écoulé';
      if (!submitting) { submitting = true; submitForm?.submit(); }
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    timer.textContent = `Temps restant : ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  submitForm?.addEventListener('submit', event => {
    if (!submitting && !confirm('Cette soumission est définitive. Continuer ?')) event.preventDefault();
  });
  refresh(); tick(); setInterval(tick, 1000);
})();
