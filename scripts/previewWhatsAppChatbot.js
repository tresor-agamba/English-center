const fs=require('fs');const path=require('path');const ejs=require('ejs');
(async()=>{
 const locals={title:'WhatsApp Chatbot',section:'messages',labels:{messages:'Messages prédéfinis'},rules:[{id:1,kind:'MESSAGE',title:'Bienvenue',body:'Bienvenue à NVA',triggers:['bonjour'],priority:10,enabled:true}],settings:{enabled:true,aiEnabled:false},budget:null,error:'',simulation:null,aiConfigured:false,layoutContext:'admin',documentLanguage:'fr',csrfField:()=>'<input type="hidden" name="_csrf" value="synthetic">',adminNavigationPath:'/whatsapp/chatbot',adminNavigationUser:{firstName:'Admin',lastName:'Test'},unreadNotificationCount:0};
 const html=await ejs.renderFile(path.resolve('views/admin/whatsapp/chatbot.ejs'),locals);
 fs.mkdirSync('output/whatsapp-chatbot',{recursive:true});fs.writeFileSync('output/whatsapp-chatbot/messages.html',html);
 const {chromium}=require('@playwright/test');const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const page=await browser.newPage();await page.route('http://nva-preview.test/**',route=>{const url=new URL(route.request().url());const filename=path.resolve('public','.'+url.pathname);if(filename.startsWith(path.resolve('public')+path.sep)&&fs.existsSync(filename)&&fs.statSync(filename).isFile())return route.fulfill({path:filename});return route.fulfill({body:'',status:404});});
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.setContent(html.replace('<head>','<head><base href="http://nva-preview.test/">'));await page.screenshot({path:'output/whatsapp-chatbot/messages-'+width+'.png',fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Horizontal overflow at '+width);}
 console.log('CHATBOT_UI_OK desktop + mobile');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
