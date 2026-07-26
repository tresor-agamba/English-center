(() => {
  const sessionSelect = document.querySelector('#trainingSessionId');
  const lessonSelect = document.querySelector('#lessonId');
  if (!sessionSelect || !lessonSelect) return;

  const filterLessons = () => {
    const courseId = sessionSelect.selectedOptions[0]?.dataset.courseId || '';
    for (const option of lessonSelect.options) {
      if (!option.value) continue;
      option.hidden = option.dataset.courseId !== courseId;
      option.disabled = option.hidden;
    }
    const selected = lessonSelect.selectedOptions[0];
    if (selected?.disabled) lessonSelect.value = '';
  };

  sessionSelect.addEventListener('change', filterLessons);
  filterLessons();
})();
