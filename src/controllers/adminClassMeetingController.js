const classMeetingService = require('../services/classMeetingService');
const attendanceService = require('../services/attendanceService');
const prisma = require('../utils/prisma');
const { OCCUPYING_ENROLLMENT_STATUSES } = require('../services/enrollmentPolicy');
const { inputPartsInZone } = require('../utils/timezone.util');

function parseOptionalId(value) {
  if (!value) return null;
  return classMeetingService.parseId(value);
}

function renderServiceError(res, error) {
  return res.status(error.statusCode || 400).render('error', {
    title: 'Séance invalide',
    message: error.message || 'Impossible de traiter cette séance.',
  });
}

async function getMeeting(value) {
  const meeting = await classMeetingService.findById(classMeetingService.parseId(value));
  if (!meeting) throw new classMeetingService.ClassMeetingError('MEETING_NOT_FOUND', 'Séance introuvable.', 404);
  return meeting;
}

async function index(req, res) {
  const filters = {
    courseId: parseOptionalId(req.query.course),
    trainingSessionId: parseOptionalId(req.query.session),
    date: typeof req.query.date === 'string' ? req.query.date : '',
    status: classMeetingService.MEETING_STATUSES.includes(req.query.status) ? req.query.status : '',
  };
  const [meetings, sessions, courses] = await Promise.all([
    classMeetingService.list(filters),
    classMeetingService.listSessions(),
    classMeetingService.listCourses(),
  ]);
  return res.render('admin/class-meetings/index', {
    title: 'Séances',
    meetings,
    sessions,
    courses,
    filters,
    statuses: classMeetingService.MEETING_STATUSES,
  });
}

async function newForm(req, res) {
  const [sessions, lessons] = await Promise.all([
    classMeetingService.listSessions(),
    classMeetingService.listLessonsCatalog(),
  ]);
  return res.render('admin/class-meetings/new', {
    title: 'Nouvelle séance',
    sessions,
    statuses: classMeetingService.MEETING_STATUSES,
    platforms: classMeetingService.MEETING_PLATFORMS,
    lessons,
    form: { trainingSessionId: req.query.session || '', status: 'SCHEDULED', platform: 'OTHER' },
    error: null,
  });
}

async function create(req, res) {
  const [sessions, lessons] = await Promise.all([
    classMeetingService.listSessions(),
    classMeetingService.listLessonsCatalog(),
  ]);
  try {
    const data = await classMeetingService.buildMeetingData(req.body);
    const meeting = await classMeetingService.create(data);
    return res.redirect(`/admin/class-meetings/${meeting.id}`);
  } catch (error) {
    if (error instanceof classMeetingService.ClassMeetingError || error?.code === 'P2002') {
      return res.status(400).render('admin/class-meetings/new', {
        title: 'Nouvelle séance',
        sessions,
        statuses: classMeetingService.MEETING_STATUSES,
        platforms: classMeetingService.MEETING_PLATFORMS,
        lessons,
        form: req.body,
        error: error?.code === 'P2002' ? 'Une séance existe déjà à cette date et cette heure.' : error.message,
      });
    }
    throw error;
  }
}

async function show(req, res) {
  const meeting = await getMeeting(req.params.id);
  const counts = { PRESENT: 0, ABSENT: 0, EXCUSED: 0 };
  meeting.attendances.forEach((attendance) => { counts[attendance.status] += 1; });
  const enrollmentCount = await prisma.enrollment.count({
    where: {
      trainingSessionId: meeting.trainingSessionId,
      status: { in: OCCUPYING_ENROLLMENT_STATUSES },
    },
  });
  let meetingHost = 'Lien privé configuré';
  try { meetingHost = new URL(meeting.privateMeetingUrl).hostname; } catch {}
  return res.render('admin/class-meetings/show', {
    title: meeting.title || 'Séance',
    meeting,
    counts,
    enrollmentCount,
    missingCount: Math.max(0, enrollmentCount - meeting.attendances.length),
    meetingHost,
  });
}

async function editForm(req, res) {
  const meeting = await getMeeting(req.params.id);
  const [sessions, lessons] = await Promise.all([
    classMeetingService.listSessions(),
    classMeetingService.listLessonsCatalog(),
  ]);
  const start = inputPartsInZone(meeting.startsAt, meeting.trainingSession.timezone);
  const end = inputPartsInZone(meeting.endsAt, meeting.trainingSession.timezone);
  return res.render('admin/class-meetings/edit', {
    title: `Modifier ${meeting.title || 'la séance'}`,
    meeting,
    sessions,
    statuses: classMeetingService.MEETING_STATUSES,
    platforms: classMeetingService.MEETING_PLATFORMS,
    lessons,
    form: {
      ...meeting,
      date: start.date,
      startTime: start.time,
      endTime: end.time,
    },
    error: null,
  });
}

async function update(req, res) {
  const meeting = await getMeeting(req.params.id);
  const [sessions, lessons] = await Promise.all([
    classMeetingService.listSessions(),
    classMeetingService.listLessonsCatalog(),
  ]);
  try {
    const data = await classMeetingService.buildMeetingData(req.body, meeting);
    await classMeetingService.update(meeting.id, data);
    return res.redirect(`/admin/class-meetings/${meeting.id}`);
  } catch (error) {
    if (error instanceof classMeetingService.ClassMeetingError || error?.code === 'P2002') {
      return res.status(400).render('admin/class-meetings/edit', {
        title: `Modifier ${meeting.title || 'la séance'}`,
        meeting,
        sessions,
        statuses: classMeetingService.MEETING_STATUSES,
        platforms: classMeetingService.MEETING_PLATFORMS,
        lessons,
        form: req.body,
        error: error?.code === 'P2002' ? 'Une séance existe déjà à cette date et cette heure.' : error.message,
      });
    }
    throw error;
  }
}

async function cancel(req, res) {
  const meeting = await getMeeting(req.params.id);
  await classMeetingService.cancel(meeting.id);
  return res.redirect(`/admin/class-meetings/${meeting.id}`);
}

async function attendanceForm(req, res) {
  try {
    const sheet = await classMeetingService.getAttendanceSheet(classMeetingService.parseId(req.params.id));
    return res.render('admin/class-meetings/attendance', {
      title: `Présences — ${sheet.meeting.title || 'Séance'}`,
      ...sheet,
      attendanceStatuses: attendanceService.ATTENDANCE_STATUSES,
      success: req.query.saved || '',
    });
  } catch (error) {
    if (error instanceof classMeetingService.ClassMeetingError) return renderServiceError(res, error);
    throw error;
  }
}

async function saveAttendance(req, res) {
  try {
    const entries = Object.entries(req.body.attendance || {}).map(([enrollmentId, status]) => ({ enrollmentId, status }));
    await attendanceService.recordAttendanceBatch(req.params.id, entries);
    return res.redirect(`/admin/class-meetings/${req.params.id}/attendance?saved=1`);
  } catch (error) {
    if (error instanceof attendanceService.AttendanceError) return renderServiceError(res, error);
    throw error;
  }
}

module.exports = { index, newForm, create, show, editForm, update, cancel, attendanceForm, saveAttendance };
