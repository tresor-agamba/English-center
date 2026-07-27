function phasePending(req, res) {
  return res.status(501).render('error', {
    title: 'Module en préparation',
    message: 'Cette fonctionnalité sera activée dans une prochaine phase.',
  });
}

module.exports = {
  index: phasePending,
  attempt: phasePending,
  responseAudio: phasePending,
  gradeAttempt: phasePending,
  liveSessions: phasePending,
  liveSession: phasePending,
  joinLiveSession: phasePending,
  startLiveSession: phasePending,
  completeLiveSession: phasePending,
  recordAttendance: phasePending,
  gradeLiveSession: phasePending,
  publishEvaluation: phasePending,
};
