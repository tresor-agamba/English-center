const fs = require('node:fs');
function edit(p, fn) { fs.writeFileSync(p, fn(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'))); }
function r(s,a,b) { if(!s.includes(a)) throw Error(a); return s.replace(a,b); }
edit('src/services/trialAccessService.js', s => {
 s = "const { accessLimits, structureSelect } = require('./courseStructureService');\n"+s;
 s = r(s, 'meeting.levelPosition > TOTAL_SESSIONS_LIMIT', 'meeting.levelPosition > (trialAccess.totalSessionsLimit || TOTAL_SESSIONS_LIMIT)');
 s = r(s, 'pricingMode: true, pricingActive: true,', 'pricingMode: true, pricingActive: true, ...structureSelect,');
 s = r(s, '            take: TOTAL_SESSIONS_LIMIT,\n','');
 s = r(s, 'const course = enrollment.trainingSession.course;', 'const course = enrollment.trainingSession.course;\n  const limits = accessLimits(course);\n  enrollment.trainingSession.classMeetings = enrollment.trainingSession.classMeetings.slice(0, limits.total);');
 s = s.replace(/attendedSessionCount >= TOTAL_SESSIONS_LIMIT/g,'attendedSessionCount >= limits.total').replace(/nextSessionLimit = TOTAL_SESSIONS_LIMIT/g,'nextSessionLimit = limits.total');
 s = r(s, '} else if (attendedSessionCount >= PARTIAL_ACCESS_LIMIT) {', "} else if (!limits.legacy) {\n    accessStage = 'PAYMENT_REQUIRED_FULL'; allowed = false; nextSessionLimit = 0;\n    blockedReason = pricingUnavailable ? 'PRICE_UNAVAILABLE' : 'FULL_PAYMENT_REQUIRED';\n  } else if (attendedSessionCount >= PARTIAL_ACCESS_LIMIT) {");
 s = r(s,'trialLimit: TRIAL_LIMIT,','trialLimit: limits.trial,');
 s = r(s,'freeSessionsLimit: TRIAL_LIMIT,','freeSessionsLimit: limits.trial,');
 s = r(s,'partialAccessLimit: PARTIAL_ACCESS_LIMIT,','partialAccessLimit: limits.partial,');
 s = r(s,'totalSessionsLimit: TOTAL_SESSIONS_LIMIT,','totalSessionsLimit: limits.total,\n    legacyStagedAccess: limits.legacy,');
 s = r(s,'Math.max(0, TRIAL_LIMIT - attendedSessionCount)','Math.max(0, limits.trial - attendedSessionCount)');
 s = r(s,'levelPosition > TOTAL_SESSIONS_LIMIT','levelPosition > trialAccess.totalSessionsLimit');
 return s;
});
edit('src/services/classMeetingService.js', s => {
 s = "const { accessLimits } = require('./courseStructureService');\n"+s;
 s = r(s,'if (count >= TOTAL_SESSIONS_LIMIT) {', `const session = await tx.trainingSession.findUnique({ where: { id: data.trainingSessionId }, include: { course: true } });
    const limit = accessLimits(session?.course).total;
    if (count >= limit) {`);
 s = r(s,"'Un niveau ne peut pas contenir plus de 16 séances.'",'`Cette session ne peut pas contenir plus de ${limit} séances.`');
 return s;
});
edit('views/student/courses/show.ejs', s => r(s,'sur 16','sur <%= access.totalSessionsLimit === 2147483647 ? "—" : access.totalSessionsLimit %>'));
edit('src/services/academicService.js', s => r(s,"const startDate = date(body.startDate, 'Date de début'), endDate = date(body.endDate, 'Date de fin');", `const course = await prisma.course.findUnique({ where: { id: id(body.courseId, 'cours') } });
  if (course?.structureType === 'LEVEL_BASED' && (course.numberOfLevels > 3 || Number(String(body.level).replace('LEVEL_', '')) > course.numberOfLevels)) throw new AcademicError('UNSUPPORTED_COURSE_LEVELS', 'Ce parcours n’est pas compatible avec les niveaux du module académique actuel.');
  const startDate = date(body.startDate, 'Date de début'), endDate = date(body.endDate, 'Date de fin');`));
