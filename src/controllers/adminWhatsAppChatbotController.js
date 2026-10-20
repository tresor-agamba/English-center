const db = require('../utils/prisma');
const { validateRule, createChatbotService } = require('../services/whatsappChatbotService');
const { createConversationEngine } = require('../services/whatsappConversationEngine');
const { createOpenAIService } = require('../services/whatsappChatbotOpenAIService');
const SECTIONS = ['overview','messages','faq','ai','settings'];
const LABELS = { overview: "Vue d’ensemble", messages: 'Messages prédéfinis', faq: 'Questions fréquentes', ai: 'Intelligence artificielle', settings: 'Paramètres' };
function id(value) { if (!/^[1-9]\d{0,8}$/.test(String(value))) throw Object.assign(new Error('Identifiant invalide.'), { statusCode: 400 }); return Number(value); }
async function render(req,res,extra={}) {
  const section = SECTIONS.includes(req.params.section) ? req.params.section : 'overview';
  const [rules, settings, budget] = await Promise.all([
    db.whatsAppChatbotRule.findMany({ orderBy: [{ priority:'desc' },{ id:'asc' }], take:100 }),
    db.whatsAppChatbotSettings.findUnique({ where:{ id:1 } }),
    db.whatsAppChatbotAiBudget.findUnique({ where:{ day:new Date().toISOString().slice(0,10) } })
  ]);
  res.set('Cache-Control','no-store');
  res.render('admin/whatsapp/chatbot', { title:'WhatsApp Chatbot', section, labels:LABELS, rules, settings, budget, error:'', simulation:null, aiConfigured:process.env.NVA_CHATBOT_AI_ENABLED==='true' && Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL), ...extra });
}
async function save(req,res) {
  try {
    const data = validateRule(req.body);
    if (req.body.id) await db.whatsAppChatbotRule.update({ where:{ id:id(req.body.id) }, data });
    else { if (await db.whatsAppChatbotRule.count() >= 100) throw Object.assign(new Error('Limite de 100 réponses atteinte.'),{statusCode:400}); await db.whatsAppChatbotRule.create({ data }); }
    res.redirect(303,'/admin/whatsapp/chatbot/' + (data.kind==='FAQ'?'faq':'messages'));
  } catch(e) { if(e.statusCode!==400) throw e; res.status(400); return render(req,res,{error:e.message}); }
}
async function remove(req,res) { await db.whatsAppChatbotRule.delete({ where:{ id:id(req.params.id) } }); res.redirect(303,'/admin/whatsapp/chatbot/messages'); }
async function settings(req,res) {
  const data={ enabled:req.body.enabled==='on', aiEnabled:req.body.aiEnabled==='on' };
  await db.whatsAppChatbotSettings.upsert({where:{id:1},create:{id:1,...data},update:data});
  res.redirect(303,'/admin/whatsapp/chatbot/settings');
}
async function simulate(req,res) {
  if(typeof req.body.text!=='string' || !req.body.text.trim() || req.body.text.length>1000) {res.status(400);return render(req,res,{error:'Saisissez un message de 1 à 1000 caractères.'});}
  // No conversation, preference, follow-up or delivery is persisted by this simulator.
  // AI must be explicitly requested; the default preview makes no external request.
  const chatbot=createChatbotService({database:db,ai:req.body.useAI==='on'?createOpenAIService({database:db}):null});
  const result=await createConversationEngine({chatbot}).handleMessage({text:req.body.text,allowCommercialFollowUpConsent:false,publicAppUrl:process.env.PUBLIC_APP_URL||''});
  return render(req,res,{simulation:result});
}
module.exports={render,save,remove,settings,simulate};
