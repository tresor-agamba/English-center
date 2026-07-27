function phasePending(req, res) {
  return res.status(501).render('error', {
    title: 'Module en préparation',
    message: 'Cette fonctionnalité sera activée dans une prochaine phase.',
  });
}

module.exports = {
  index: phasePending,
  show: phasePending,
  createAttempt: phasePending,
  showAttempt: phasePending,
  uploadResponse: phasePending,
  submitAttempt: phasePending,
  result: phasePending,
  liveSessions: phasePending,
  liveSession: phasePending,
  joinLiveSession: phasePending,
};
