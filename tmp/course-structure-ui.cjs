const assert = require('node:assert/strict');
assert.equal(process.env.NODE_ENV, 'test'); assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const prisma = require('../src/utils/prisma'), app = require('../src/app');
const courses = require('../src/services/courseService'), sessions = require('../src/services/trainingSessionService');
(async () => {
 const ids=[], userIds=[], key=String(Date.now()), output=path.resolve('tmp/course-structure-ui'); fs.mkdirSync(output,{recursive:true});
 let server, browser;
 try {
  const create=async data=>{const c=await courses.create({title:'Excel pratique',slug:`presentation-${ids.length}-${key}`,structureType:'SIMPLE',accessPolicy:'FULL_PAYMENT',durationValue:12,durationUnit:'HOURS',sessionCount:8,price:'40',currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,shortDescription:'Une formation pratique avec des exercices guidés.',...data});ids.push(c.id);await courses.publish(c.id);return c;};
  const excel=await create({}), english=await create({title:'Anglais général',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,durationValue:24,price:'60'});
  const session=await sessions.create({courseId:english.id,levelNumber:1,name:'Niveau 1 – Octobre 2026',startDate:new Date(Date.now()+864000000),endDate:new Date(Date.now()+8640000000),registrationDeadline:new Date(Date.now()+432000000),capacity:20,status:'OPEN',platform:'Zoom',weekDays:['MONDAY'],startTime:'10:00',endTime:'11:30'});
  await sessions.createRegistrationGroup({trainingSessionId:session.id,name:'Matin',capacity:20,weekDays:['MONDAY'],startTime:'10:00',endTime:'11:30'});
  const password=require('node:crypto').randomBytes(20).toString('base64url');
  const admin=await prisma.user.create({data:{firstName:'Admin',lastName:'Présentation',phoneNumber:`+24389${key.slice(-7)}`,role:'ADMIN',passwordHash:await require('../src/services/passwordService').hashPassword(password)}});userIds.push(admin.id);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();await context.addCookies([{name:'nva-language',value:'fr',url:base}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let layouts=0;
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   for(const [name,url] of [['catalogue','/formations'],['simple',`/formations/${excel.slug}`],['levels',`/formations/${english.slug}`],['registration',`/register?session=${session.id}`]]){
    await page.goto(base+url);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name} ${width}`);
    if(name==='levels'){assert.ok((await page.locator('body').innerText()).includes('60'));assert.ok((await page.locator('body').innerText()).includes('72'));}
    await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true});layouts++;
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+`/formations/${english.slug}`);
  await page.locator('header [data-language="en"]').first().click();assert.ok((await page.locator('body').innerText()).includes('Payment is made one level at a time.'));
  await page.locator('header [data-language="fr"]').first().click();assert.ok((await page.locator('body').innerText()).includes('Le paiement s’effectue niveau par niveau.'));
  await page.goto(base+'/login');await page.locator('[name="phoneNumber"]').fill(admin.phoneNumber);await page.locator('[name="password"]').fill(password);await page.locator('form button[type="submit"]').click();await page.waitForURL('**/admin/dashboard');
  await page.goto(base+'/admin/courses/new');await page.locator('#structureType').selectOption('LEVEL_BASED');assert.equal(await page.locator('#numberOfLevels').isVisible(),true);
  await page.locator('#numberOfLevels').fill('3');await page.locator('#sessionCount').fill('16');await page.locator('#durationValue').fill('24');await page.locator('#durationUnit').selectOption('HOURS');await page.locator('#price').fill('60');
  assert.match(await page.locator('[data-structure-preview]').innerText(),/3 niveaux · 48 séances · 72 heures · 180.00 USD/);
  await page.screenshot({path:path.join(output,'admin-levels-1440.png'),fullPage:true});layouts++;
  await page.locator('#structureType').selectOption('SIMPLE');assert.equal(await page.locator('#numberOfLevels').isVisible(),false);assert.equal(await page.locator('#numberOfLevels').isDisabled(),true);assert.equal(await page.locator('label[for="price"]').innerText(),'Prix de la formation');
  await page.setViewportSize({width:390,height:1000});await page.screenshot({path:path.join(output,'admin-simple-390.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);layouts++;
  await page.goto(base+'/admin/sessions/new');await page.locator('#courseId').selectOption(String(english.id));assert.equal(await page.locator('#levelNumber').isVisible(),true);assert.equal(await page.locator('#levelNumber').getAttribute('max'),'3');await page.locator('#courseId').selectOption(String(excel.id));assert.equal(await page.locator('#levelNumber').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({layouts,languageSwitches:2,adminDynamic:true,sessionDynamic:true,jsErrors:errors.length}));
 }finally{
  if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await prisma.course.deleteMany({where:{id:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:userIds}}});await prisma.$disconnect();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
