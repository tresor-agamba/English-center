function phasePending(req, res) {
  return res.status(501).render('error', {
    title: 'Module en préparation',
    message: 'Cette fonctionnalité sera activée dans une prochaine phase.',
  });
}

module.exports = {
  index: phasePending,
  newForm: phasePending,
  create: phasePending,
  show: phasePending,
  update: phasePending,
  publish: phasePending,
  close: phasePending,
  configureCriteria: phasePending,
  createLiveSession: phasePending,
  rescheduleLiveSession: phasePending,
  cancelLiveSession: phasePending,
};
