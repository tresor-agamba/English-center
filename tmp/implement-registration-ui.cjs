const fs=require('node:fs');function edit(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n')));}function r(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('src/services/registrationService.js',s=>r(s,'id: course.id, title: course.title, slug: course.slug, price:', 'durationValue: course.durationValue, durationUnit: course.durationUnit, id: course.id, title: course.title, slug: course.slug, price:'));
edit('views/public/registration/new.ejs',s=>{
 s=r(s,'data-course-title="<%= session.course.title %>"',`data-course-title="<%= session.course.title %>" data-structure="<%= session.course.structureType %>" data-access-policy="<%= session.course.accessPolicy %>" data-level-number="<%= session.levelNumber || '' %>" data-session-count="<%= session.course.sessionCount || '' %>" data-duration-value="<%= session.course.durationValue || '' %>" data-duration-unit="<%= session.course.durationUnit || '' %>" data-session-name="<%= session.name %>"`);
 s=r(s,'data-session-name="<%= course.session?.name || \'\' %>"',`data-structure="<%= course.structureType %>" data-access-policy="<%= course.accessPolicy %>" data-level-number="<%= course.session?.levelNumber || '' %>" data-session-count="<%= course.sessionCount || '' %>" data-duration-value="<%= course.durationValue || '' %>" data-duration-unit="<%= course.durationUnit || '' %>" data-session-name="<%= course.session?.name || '' %>"`);
 s=r(s,'<div class="nva-register-field"><label for="requestedLevel"', '<div class="nva-register-field" data-level-field><label for="requestedLevel"');
 // No-JS clients can leave this field blank: the session determines the level on the server.
 s=r(s,'name="requestedLevel" required data-requested-level>','name="requestedLevel" data-requested-level><option value="">Selon la session / According to the session</option>');
 return s;
});
edit('public/js/main.js',s=>{
 s=r(s,'  const updateLevelGuidance = () => {', `  const updateLevelGuidance = () => {
    const courseInput = registrationForm.querySelector('[name="courseId"]');
    const selected = courseInput?.tagName === 'SELECT' ? courseInput.selectedOptions[0] : courseInput;
    const leveled = selected?.dataset.structure === 'LEVEL_BASED';
    const historical = selected?.dataset.accessPolicy !== 'FULL_PAYMENT' && !leveled;
    level.closest('[data-level-field]').hidden = !historical;
    if (leveled) level.value = 'LEVEL_' + selected.dataset.levelNumber;
    else if (!historical) level.value = '';
    const guidance = registrationForm.querySelector('.level-guidance');
    if (guidance) guidance.hidden = !leveled && !historical;`);
 s=r(s,'  courseSelect?.addEventListener(\'change\', updateRegistrationSession);',"  courseSelect?.addEventListener('change', updateLevelGuidance);\n  courseSelect?.addEventListener('change', updateRegistrationSession);");
 const line=s.split('\n').find(x=>x.includes("const rows = [['Formation'"));
 if(!line)throw Error('recap');
 s=s.replace(line,`      const leveled = courseOption?.dataset.structure === 'LEVEL_BASED';
      const duration = courseOption?.dataset.durationValue ? courseOption.dataset.durationValue + ' ' + ({HOURS:'heures',DAYS:'jours',WEEKS:'semaines',MONTHS:'mois'}[courseOption.dataset.durationUnit] || '') : 'Selon la formation';
      const programme = [courseOption?.dataset.sessionCount ? courseOption.dataset.sessionCount + ' séances' : '', duration].filter(Boolean).join(' · ');
      const rows = [['Formation', courseOption?.textContent?.trim() || courseInput.dataset.courseTitle || '—'], ...(leveled ? [['Niveau', courseOption.dataset.levelNumber]] : []), ['Session', courseOption?.dataset.sessionName || '—'], ['Jours', groupOption?.dataset.days || 'Selon la session'], ['Horaire', groupOption?.dataset.time || 'Selon la session'], [leveled ? 'Programme du niveau' : 'Programme', programme], [leveled ? 'Prix du niveau' : 'Prix de la formation', price + ' ' + currency], ['Frais supplémentaires', fee + ' ' + currency], ['Total à payer pour cette inscription', (price + fee) + ' ' + currency]];`);
 return s;
});
edit('views/public/registration/success.ejs',s=>{
 s=r(s,"<% } else if (enrollment.status === 'PAYMENT_REQUIRED') { %>",`<% } else if (enrollment.status === 'PAYMENT_REQUIRED' && trialAccess.legacyStagedAccess === false) { %>
    <div class="trial-notice"><strong>Votre inscription est enregistrée.</strong><span>Le paiement complet de cette inscription est requis avant l’accès aux séances.</span></div>
  <% } else if (enrollment.status === 'PAYMENT_REQUIRED') { %>`);
 s=r(s,'data-i18n="success.price">Prix</span>',`data-i18n="<%= enrollment.trainingSession.course.structureType === 'LEVEL_BASED' ? 'structure.pricePerLevel' : 'success.price' %>"><%= enrollment.trainingSession.course.structureType === 'LEVEL_BASED' ? 'Prix par niveau' : 'Prix' %></span>`);
 return s;
});
edit('views/student/enrollment/confirm.ejs',s=>r(s,'<div><dt>Prix</dt>',"<div><dt><%= session.course.structureType === 'LEVEL_BASED' ? 'Prix du niveau' : 'Prix de la formation' %></dt>"));
