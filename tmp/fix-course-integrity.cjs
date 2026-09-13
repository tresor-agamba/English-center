const fs=require('node:fs');function edit(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n')));}function r(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('src/controllers/adminCourseController.js',s=>r(s,'const data = parseForm({ ...course, ...req.body });',"const data = parseForm({ ...course, ...req.body, ...(req.body.structureType === 'SIMPLE' && req.body.numberOfLevels === undefined ? { numberOfLevels: null } : {}) });"));
edit('src/services/registrationService.js',s=>{
 s=r(s,"status: level && level !== 'LEVEL_1' ? 'PLACEMENT_TEST_REQUIRED'", "status: accessLimits(session.course).legacy && level && level !== 'LEVEL_1' ? 'PLACEMENT_TEST_REQUIRED'");
 s=r(s,"approvedLevel: level === 'LEVEL_1' ? 'LEVEL_1' : null,", "approvedLevel: !accessLimits(session.course).legacy ? level : (level === 'LEVEL_1' ? 'LEVEL_1' : null),");
 s=r(s,"placementTestRequired: Boolean(level && level !== 'LEVEL_1'),", "placementTestRequired: Boolean(accessLimits(session.course).legacy && level && level !== 'LEVEL_1'),");
 s=r(s,"status: registrationLevel(availableSession) && availableSession.levelNumber > 1 ? 'PLACEMENT_TEST_REQUIRED'", "status: accessLimits(availableSession.course).legacy && registrationLevel(availableSession) && availableSession.levelNumber > 1 ? 'PLACEMENT_TEST_REQUIRED'");
 s=r(s,"approvedLevel: availableSession.levelNumber === 1 ? 'LEVEL_1' : null,", "approvedLevel: !accessLimits(availableSession.course).legacy ? registrationLevel(availableSession) : (availableSession.levelNumber === 1 ? 'LEVEL_1' : null),");
 s=r(s,"placementTestRequired: isLevelBased(availableSession.course) && availableSession.levelNumber > 1,", "placementTestRequired: accessLimits(availableSession.course).legacy && isLevelBased(availableSession.course) && availableSession.levelNumber > 1,");
 s=r(s,"const reactivatedStatus =\n          existingEnrollment.status", "const reactivatedStatus = !accessLimits(session.course).legacy ? 'PAYMENT_REQUIRED' :\n          existingEnrollment.status");
 return s;
});
edit('public/js/main.js',s=>r(s,"if (guidance) guidance.hidden = !leveled && !historical;", "if (guidance) guidance.hidden = selected?.dataset.accessPolicy === 'FULL_PAYMENT' || (!leveled && !historical);"));
edit('src/services/lmsCourseService.js',s=>r(s,"...courseData(body), createdById: user.id", "...courseData(body), accessPolicy: 'FULL_PAYMENT', createdById: user.id"));
edit('src/services/placementTestService.js',s=>{
 s=s.replaceAll("course: { select: { title: true } }", "course: { select: { title: true, structureType: true } }");
 s=r(s,"const enrollment = await getPendingEnrollment(enrollmentId, studentId, tx);",`const enrollment = await getPendingEnrollment(enrollmentId, studentId, tx);
    const explicitLevel = enrollment.trainingSession.course.structureType === 'LEVEL_BASED' ? enrollment.trainingSession.levelNumber : null;
    if (explicitLevel && Number(level.replace('LEVEL_', '')) < explicitLevel) throw new PlacementTestError('SESSION_LEVEL_NOT_REACHED', 'Le niveau requis pour cette session n’est pas atteint. Contactez l’administration pour une session adaptée.');`);
 s=r(s,'approvedLevel: level,',"approvedLevel: explicitLevel ? 'LEVEL_' + explicitLevel : level,");
 return s;
});
