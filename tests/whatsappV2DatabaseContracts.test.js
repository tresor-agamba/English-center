const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {TrainingSessionStatus,DurationUnit,Prisma}=require('@prisma/client');
const {recordConfirmed}=require('../src/services/whatsappAdmissionService');
test('real Prisma enums distinguish cancelled sessions from closed registration deadlines',()=>{
 assert.equal(TrainingSessionStatus.CANCELLED,'CANCELLED');assert.equal(TrainingSessionStatus.CLOSED,undefined);assert.equal(DurationUnit.WEEKS,'WEEKS');assert.equal(DurationUnit.WEEK,undefined);
});
test('deleted course is rejected as a validation error before any admission write',async()=>{
 let writes=0;const tx={course:{findUnique:async()=>null},whatsAppAdmissionRequest:{findUnique:async()=>null,create:async()=>{writes++;}}};
 await assert.rejects(recordConfirmed(tx,{conversationId:1,sourceMessageId:'db-deleted-course',consentVersion:'admissions-v1',data:{fullName:'Alice Mukendi',phoneNumber:'+243890001003',email:'alice@example.test',requestedLevel:'BEGINNER',courseId:12}}),e=>e.statusCode===400&&/plus disponible/.test(e.message));assert.equal(writes,0);
});
test('Prisma metadata contains actual integration fields and relational identities',()=>{
 const models=Object.fromEntries(Prisma.dmmf.datamodel.models.map(m=>[m.name,m]));
 for(const [name,fields]of Object.entries({Course:['price','certificateFee','numberOfLevels'],TrainingSession:['levelNumber','registrationGroups','capacity'],Enrollment:['userId','trainingSessionId'],WhatsAppAdmissionRequest:['conversationId','sourceMessageId','consentAt','enrollmentId'],User:['phoneNumber','email','passwordHash','mustChangePassword']}))for(const field of fields)assert.ok(models[name].fields.some(f=>f.name===field),name+'.'+field);
 assert.ok(!models.User.fields.some(f=>f.name==='emailVerified'));
 const sql=fs.readFileSync('prisma/migrations/20261022120000_add_whatsapp_admission_requests/migration.sql','utf8');assert.match(sql,/whatsapp_admission_one_open_per_conversation/);assert.match(sql,/"sourceMessageId" VARCHAR\(256\) NOT NULL UNIQUE/);
 // Source declaration checks only; no assertion that these exist on a live server.
});
