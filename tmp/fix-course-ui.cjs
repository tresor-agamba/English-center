const fs=require('node:fs');function edit(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n')));}function r(s,a,b){if(!s.includes(a))throw Error(a);return s.replace(a,b);}
edit('views/partials/public-course-card.ejs',s=>r(s,"{ course: courseCard.course }","{ course: courseCard.course, totals: courseCard.totals }"));
edit('src/services/registrationService.js',s=>{
 s=r(s,'              title: true,\n              slug: true,','              title: true, ...structureSelect,\n              slug: true,');
 s=r(s,'          name: true,\n          startDate: true,','          name: true, levelNumber: true,\n          startDate: true,');
 return s;
});
edit('src/controllers/registrationController.js',s=>r(s,"requestedLevel: 'LEVEL_1'","requestedLevel: ''"));
edit('views/student/courses/show.ejs',s=>{
 s=r(s,'  <article class="card"><strong>Séances d’essai</strong>', '  <% if (access.legacyStagedAccess !== false) { %><article class="card"><strong>Séances d’essai</strong>');
 s=r(s,' restantes</span></article>',' restantes</span></article><% } %>');
 s=r(s,'<strong>Prix total</strong>',"<strong><%= course.structureType === 'LEVEL_BASED' ? 'Prix du niveau' : 'Prix total' %></strong>");
 s=r(s,'  <article class="card"><strong>Montant nécessaire pour atteindre 50 %</strong>', '  <% if (access.legacyStagedAccess !== false) { %><article class="card"><strong>Montant nécessaire pour atteindre 50 %</strong>');
 s=r(s,'<%= Number(access.paidPercentage) >= 50 ? 0 : access.nextRequiredPaymentAmount %> <%= access.expectedCurrency %></span></article>','<%= Number(access.paidPercentage) >= 50 ? 0 : access.nextRequiredPaymentAmount %> <%= access.expectedCurrency %></span></article><% } %>');
 return s;
});
