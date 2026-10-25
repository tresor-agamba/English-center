const router=require('express').Router();
const verification=require('../services/whatsappAdmissionVerification');
const asyncHandler=require('../middlewares/asyncHandler');
const limits=require('../middlewares/rateLimits');
router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');next();});
router.get('/whatsapp/admission-email',(req,res)=>res.render('auth/admission-email',{title:'Vérification e-mail NVA',message:''}));
router.post('/whatsapp/admission-email',limits.passwordReset,asyncHandler(async(req,res)=>{
 try{await verification.verify(req.body.requestId,req.body.token);res.render('auth/admission-email',{title:'Vérification e-mail NVA',message:'Adresse vérifiée. Votre demande reste en attente de décision administrative.'});}
 catch(e){if(![400,404,409].includes(e.statusCode))throw e;res.status(400).render('auth/admission-email',{title:'Vérification e-mail NVA',message:'Code invalide, déjà utilisé ou expiré.'});}
}));
module.exports=router;
