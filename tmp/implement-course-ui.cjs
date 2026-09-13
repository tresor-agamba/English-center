const fs=require('node:fs');
function edit(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n')));}
function r(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('src/app.js',s=>r(s,'app.locals.passwordMinLength = PASSWORD_MIN_LENGTH;',"app.locals.passwordMinLength = PASSWORD_MIN_LENGTH;\napp.locals.courseTotals = require('./utils/publicCoursePresentation.util').courseTotals;"));
edit('views/admin/courses/_form.ejs',s=>{
 s=r(s,'  <label for="title">Titre</label>',`  <label for="structureType">Structure de la formation</label>
  <select id="structureType" name="structureType" required><option value="SIMPLE" <%= form.structureType !== 'LEVEL_BASED' ? 'selected' : '' %>>Formation simple</option><option value="LEVEL_BASED" <%= form.structureType === 'LEVEL_BASED' ? 'selected' : '' %>>Formation par niveaux</option></select>
  <div data-level-fields <%= form.structureType === 'LEVEL_BASED' ? '' : 'hidden' %>><label for="numberOfLevels">Nombre de niveaux</label><input id="numberOfLevels" name="numberOfLevels" type="number" min="1" max="2147483647" step="1" value="<%= form.numberOfLevels || '' %>" <%= form.structureType === 'LEVEL_BASED' ? 'required' : 'disabled' %>></div>
  <label for="sessionCount"><%= form.structureType === 'LEVEL_BASED' ? 'Séances par niveau' : 'Nombre de séances' %></label><input id="sessionCount" name="sessionCount" type="number" min="1" step="1" value="<%= form.sessionCount || '' %>" <%= form.structureType === 'LEVEL_BASED' ? 'required' : '' %>>
  <p class="form-hint" data-structure-preview aria-live="polite"></p>
  <label for="title">Titre</label>`);
 s=r(s,'maxlength="100" required','maxlength="100"');
 s=r(s,'<label for="level">Niveau</label>','<label for="level">Public / niveau descriptif (facultatif)</label>');
 s=r(s,'<label for="durationValue">Durée</label>','<label for="durationValue"><%= form.structureType === "LEVEL_BASED" ? "Durée par niveau" : "Durée de la formation" %></label>');
 s=r(s,'<label for="price">Prix de la formation</label>','<label for="price"><%= form.structureType === "LEVEL_BASED" ? "Prix par niveau" : "Prix de la formation" %></label>');
 s=r(s,'    <p class="form-hint"><strong>Séances gratuites : 5.</strong> Les paiements partiels confirmés sont cumulés : 50 % ouvre les séances 6 à 10 et 100 % ouvre les séances 11 à 16.</p>',`    <label for="accessPolicy">Accès aux séances</label><select id="accessPolicy" name="accessPolicy"><option value="FULL_PAYMENT" <%= form.accessPolicy === 'FULL_PAYMENT' ? 'selected' : '' %>>Paiement complet avant accès</option><option value="LEGACY_STAGED" <%= form.accessPolicy !== 'FULL_PAYMENT' ? 'selected' : '' %>>Règle historique : 5 gratuites, 50 % jusqu’à 10, 100 % jusqu’à 16</option></select>
    <p class="form-hint">Les paiements partiels restent possibles. La règle historique exige 16 séances ; elle ne s’applique pas automatiquement aux nouvelles formations.</p>`);
 return s+'\n<script src="/js/course-structure-admin.js" defer></script>\n';
});
edit('views/admin/sessions/_form.ejs',s=>{
 s=r(s,'<option value="<%= course.id %>"','<option data-structure="<%= course.structureType %>" data-levels="<%= course.numberOfLevels || \'\' %>" value="<%= course.id %>"');
 s=r(s,'  <div class="form-grid">',`  <div data-session-level><label for="levelNumber">Numéro du niveau (formation par niveaux)</label><input id="levelNumber" name="levelNumber" type="number" min="1" step="1" value="<%= form.levelNumber || '' %>"><p class="form-hint">Obligatoire pour une formation par niveaux. Au-delà du niveau 3, inscription académique indisponible dans cette phase.</p></div>
  <div class="form-grid">`);
 return s+'\n<script src="/js/course-structure-admin.js" defer></script>\n';
});
edit('views/partials/public-course-card.ejs',s=>r(s,'    <div class="nva-public-course-card__actions">',`    <% if (courseCard.course) { %><%- include('course-structure-summary', { course: courseCard.course }) %><% } %>
    <div class="nva-public-course-card__actions">`));
edit('views/public/courses/show.ejs',s=>{
 s=r(s,'const typeLabel = formatCourseType(course.courseType);','const summary = courseTotals(course); const typeLabel = formatCourseType(course.courseType);');
 s=r(s,"const durationLabel = formatDuration(course);","const durationLabel = formatDuration(summary.levelBased ? { ...course, durationValue: summary.totalDuration } : course);");
 s=r(s,'      <figure class="course-detail-image">',`      <%- include('../../partials/course-structure-summary', { course }) %>
      <% if (summary.levelBased) { %><div class="course-information-grid"><% for (let n = 1; n <= Math.min(summary.numberOfLevels, 20); n++) { %><article class="public-info-card"><h2><span data-i18n="detail.level">Niveau</span> <%= n %></h2><p><%= course.sessionCount %> <span data-i18n="structure.sessions">séances</span></p><p data-local-duration data-value="<%= course.durationValue %>" data-unit="<%= course.durationUnit %>"><%= formatDuration(course) %></p><p data-local-price data-amount="<%= course.price %>" data-currency="<%= course.currency %>"><%= course.price %> <%= course.currency %></p></article><% } %></div><% if (summary.numberOfLevels > 20) { %><p><span data-i18n="structure.preview">Aperçu des 20 premiers niveaux ; mêmes conditions pour les niveaux suivants.</span></p><% } %><% } %>
      <figure class="course-detail-image">`);
 s=r(s,'<span data-i18n="detail.perCourse">/ course</span>','<% if (summary.levelBased) { %><span data-i18n="structure.perLevel">/ niveau</span><% } %>');
 s=r(s,'      <p class="course-panel-status',`      <% if (summary.levelBased) { %><p><span data-local-duration data-value="<%= course.durationValue %>" data-unit="<%= course.durationUnit %>"><%= formatDuration(course) %></span> <span data-i18n="structure.perLevel">/ niveau</span></p><p><%= course.sessionCount %> <span data-i18n="structure.sessionsPerLevel">séances par niveau</span></p><% } %>
      <p class="course-panel-status`);
 s=r(s,'<h3><%= session.name %></h3>','<h3><%= session.name %></h3><% if (session.levelNumber) { %><p><span data-i18n="detail.level">Niveau</span> <%= session.levelNumber %></p><% } %><% if (session.levelNumber > 3) { %><p data-i18n="structure.adminRequired">Contactez l’administration pour ce niveau.</p><% } %>');
 return s;
});
edit('public/js/i18n.js',s=>{
 s=r(s,"'form.level': 'Requested level'",`'structure.durationPerLevel': 'Duration per level', 'structure.pricePerLevel': 'Price per level', 'structure.complete': 'Complete programme', 'structure.levels': 'levels', 'structure.sessions': 'sessions', 'structure.totalPrice': 'Indicative total price', 'structure.payment': 'Payment is made one level at a time.', 'structure.perLevel': '/ level', 'structure.sessionsPerLevel': 'sessions per level', 'structure.preview': 'Preview of the first 20 levels; the same terms apply to subsequent levels.', 'structure.adminRequired': 'Contact the administration for this level.',
      'form.level': 'Requested level'`);
 s=r(s,"'form.level': 'Niveau demandé'",`'structure.durationPerLevel': 'Durée par niveau', 'structure.pricePerLevel': 'Prix par niveau', 'structure.complete': 'Parcours complet', 'structure.levels': 'niveaux', 'structure.sessions': 'séances', 'structure.totalPrice': 'Prix total indicatif', 'structure.payment': 'Le paiement s’effectue niveau par niveau.', 'structure.perLevel': '/ niveau', 'structure.sessionsPerLevel': 'séances par niveau', 'structure.preview': 'Aperçu des 20 premiers niveaux ; mêmes conditions pour les niveaux suivants.', 'structure.adminRequired': 'Contactez l’administration pour ce niveau.',
      'form.level': 'Niveau demandé'`);
 return s;
});
edit('src/services/publicCourseService.js',s=>{
 s=r(s,'const availableSessions = trainingSessions','const availableSessions = trainingSessions\n      .filter(session => course.structureType !== \'LEVEL_BASED\' || (session.levelNumber >= 1 && session.levelNumber <= Math.min(course.numberOfLevels, 3)))');
 // list select must include levelNumber for eligibility.
 s=r(s,'          id: true,\n          startDate: true,','          id: true, levelNumber: true,\n          startDate: true,');
 s=r(s,"session.status === 'OPEN' &&\n", "session.status === 'OPEN' &&\n        (course.structureType !== 'LEVEL_BASED' || (session.levelNumber >= 1 && session.levelNumber <= Math.min(course.numberOfLevels, 3))) &&\n");
 return s;
});
