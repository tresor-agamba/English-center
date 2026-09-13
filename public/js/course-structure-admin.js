(() => {
  const form = document.querySelector('.course-admin-form');
  if (form) {
    const field = name => form.elements.namedItem(name);
    const update = () => {
      const levels = field('structureType').value === 'LEVEL_BASED';
      form.querySelector('[data-level-fields]').hidden = !levels;
      field('numberOfLevels').disabled = !levels; field('numberOfLevels').required = levels;
      field('sessionCount').required = levels;
      form.querySelector('label[for="price"]').textContent = levels ? 'Prix par niveau' : 'Prix de la formation';
      form.querySelector('label[for="durationValue"]').textContent = levels ? 'Durée par niveau' : 'Durée de la formation';
      form.querySelector('label[for="sessionCount"]').textContent = levels ? 'Séances par niveau' : 'Nombre de séances';
      const preview = form.querySelector('[data-structure-preview]'); preview.hidden = !levels;
      const count = Number(field('numberOfLevels').value), duration = Number(field('durationValue').value), sessions = Number(field('sessionCount').value);
      // Preview only. Authoritative monetary calculation uses Prisma.Decimal on the server.
      const amount = Number(field('price').value) * count;
      preview.textContent = count > 0 && duration > 0 && sessions > 0 && Number.isFinite(amount)
        ? `Parcours complet : ${count} niveaux · ${count * sessions} séances · ${count * duration} ${field('durationUnit').selectedOptions[0].textContent.toLowerCase()} · ${amount.toFixed(2)} ${field('currency').value}`
        : 'Renseignez les niveaux, la durée, les séances et le tarif pour afficher le parcours complet.';
    };
    form.addEventListener('input', update); form.addEventListener('change', update); update();
  }
  const sessionForm = document.querySelector('.session-form');
  if (sessionForm) {
    const course = sessionForm.elements.namedItem('courseId'), level = sessionForm.elements.namedItem('levelNumber');
    const update = () => {
      const selected = course.selectedOptions[0], required = selected?.dataset.structure === 'LEVEL_BASED';
      level.closest('[data-session-level]').hidden = !required;
      level.disabled = !required; level.required = required;
      if (required) level.max = selected.dataset.levels;
    };
    course.addEventListener('change', update); update();
  }
})();
