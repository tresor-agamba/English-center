const TRIAL_LIMIT = 5;
const PARTIAL_ACCESS_LIMIT = 10;
const TOTAL_SESSIONS_LIMIT = 16;
const OCCUPYING_ENROLLMENT_STATUSES = ['TRIAL_ACTIVE', 'PLACEMENT_TEST_REQUIRED', 'PAYMENT_REQUIRED', 'CONFIRMED'];
const NON_OCCUPYING_ENROLLMENT_STATUSES = ['CANCELLED', 'PAYMENT_FAILED'];

function remainingPlaces(session) {
  const occupied = session?._count?.enrollments ?? session?.occupiedPlaces ?? 0;
  return Math.max(0, Number(session?.capacity || 0) - Number(occupied || 0));
}

function sessionRegistrationState(session, now = new Date()) {
  if (!session || session.status !== 'OPEN' || session.startDate < now) return 'UNAVAILABLE';
  if (session.registrationDeadline < now) return 'CLOSED';
  if (remainingPlaces(session) < 1) return 'FULL';
  return 'OPEN';
}

function isSessionOpenForRegistration(session, now = new Date()) {
  return sessionRegistrationState(session, now) === 'OPEN';
}

module.exports = {
  TRIAL_LIMIT,
  PARTIAL_ACCESS_LIMIT,
  TOTAL_SESSIONS_LIMIT,
  OCCUPYING_ENROLLMENT_STATUSES,
  NON_OCCUPYING_ENROLLMENT_STATUSES,
  remainingPlaces,
  sessionRegistrationState,
  isSessionOpenForRegistration,
};
