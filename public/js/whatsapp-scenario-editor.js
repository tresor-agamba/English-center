(() => {
 'use strict';
 const form=document.querySelector('[data-scenario-editor]');if(!form)return;
 const container=form.querySelector('[data-nodes]'),source=form.querySelector('[data-definition]'),entry=form.querySelector('[data-entry]'),error=form.querySelector('[data-editor-error]');
 let definition;
 try{definition=JSON.parse(source.value)}catch{error.textContent='La définition est invalide. Corrigez le scénario avant de poursuivre.';return;}
 entry.value=definition.entry;
 const nodeReaders=[];
 function el(tag,text){const x=document.createElement(tag);if(text)x.textContent=text;return x;}
 function input(parent,title,value='',type='text') {const label=el('label',title),x=el(type==='textarea'?'textarea':'input');if(type!=='textarea')x.type=type;x.value=value;label.append(x);parent.append(label);return x;}
 function select(parent,title,items,value){const label=el('label',title),x=el('select');items.forEach(([v,t])=>{const o=el('option',t);o.value=v;x.append(o)});x.value=value;label.append(x);parent.append(label);return x;}
 function button(parent,title,handler){const x=el('button',title);x.type='button';x.className='button button-secondary';x.addEventListener('click',handler);parent.append(x);return x;}
 function condition(parent,value){const wrap=el('div');wrap.className='form-grid';parent.append(wrap);const field=select(wrap,'Condition',[['','Toujours'],['selectedCourse','Cours sélectionné'],['commercialConsent','Accord commercial acquis'],['prospect','Prospect non inscrit']],value?.field||'');const equals=select(wrap,'Valeur attendue',[['true','Oui'],['false','Non']],String(value?.equals??true));return ()=>field.value?{field:field.value,equals:equals.value==='true'}:null;}
 function action(parent,title,value){const wrap=el('fieldset');wrap.append(el('legend',title));parent.append(wrap);const type=select(wrap,'Action',[['','Aucune'],['END','Terminer'],['GOTO','Aller à un nœud / scénario'],['HANDOFF','Transférer à un conseiller'],['CATALOG','Consulter le catalogue NVA']],value?.type||'');const target=input(wrap,'Nœud cible (pour transition)',value?.nodeId||'');const scenario=input(wrap,'ID du scénario cible (vide = même scénario)',value?.scenarioId||'');const intent=select(wrap,'Sujet catalogue',[['CATALOG','Formations'],['PRICE','Tarifs'],['SCHEDULE','Horaires'],['TRIAL','Essai'],['REGISTRATION','Inscription']],value?.intent||'CATALOG');
 const refresh=()=>{target.parentElement.hidden=type.value!=='GOTO';scenario.parentElement.hidden=type.value!=='GOTO';intent.parentElement.hidden=type.value!=='CATALOG';};type.addEventListener('change',refresh);refresh();
 const read=()=>type.value==='GOTO'?{type:'GOTO',nodeId:target.value.trim(),...(scenario.value.trim()?{scenarioId:scenario.value.trim()}:{})}:type.value==='CATALOG'?{type:'CATALOG',intent:intent.value}:type.value?{type:type.value}:null;read.element=wrap;return read;}
 function addNode(n){const panel=el('details');panel.open=true;panel.className='wa-scenario-node';panel.append(el('summary','Nœud '+n.id));container.append(panel);const id=input(panel,'Identifiant du nœud',n.id);id.readOnly=true;
 const type=select(panel,'Format',[['button','Boutons rapides'],['list','Menu de liste'],['text','Réponse prédéfinie']],n.type);const body=input(panel,'Message',n.body,'textarea');body.rows=3;body.required=true;
 const buttonLabel=input(panel,'Libellé du bouton de liste',n.buttonLabel||'Choisir');buttonLabel.maxLength=20;
 const readCondition=condition(panel,n.condition),readOtherwise=action(panel,'Si la condition échoue / aucune option disponible',n.otherwise),readNext=action(panel,'Action après une réponse texte',n.next);
 const optionsBox=el('div');panel.append(optionsBox);const readers=[];
 function addOption(o){if(readers.filter(r=>r.panel.isConnected).length>=(type.value==='button'?3:10)){error.textContent='Limite atteinte pour ce format.';return;}
 const box=el('details');box.open=!o.id;const summary=el('summary',o.label||'Nouvelle option');box.append(summary);optionsBox.append(box);const label=input(box,'Libellé affiché',o.label||'');label.addEventListener('input',()=>{summary.textContent=label.value||'Nouvelle option';});label.required=true;const stable=input(box,'Identifiant stable du clic',o.id||crypto.randomUUID());stable.readOnly=true;
 const readCond=condition(box,o.condition),readAction=action(box,'Au clic',o.action||{type:'HANDOFF'});button(box,'Retirer cette option',()=>box.remove());readers.push({panel:box,read:()=>({id:stable.value,label:label.value,condition:readCond(),action:readAction()})});}
 (n.options||[]).forEach(addOption);const add=button(panel,'Ajouter une option',()=>addOption({}));
 function refresh(){const isText=type.value==='text';readNext.element.hidden=!isText;optionsBox.hidden=isText;for(const field of optionsBox.querySelectorAll('input,textarea,select'))field.disabled=isText;add.hidden=isText;buttonLabel.parentElement.hidden=type.value!=='list';body.maxLength=isText?2000:1024;}
 type.addEventListener('change',refresh);refresh();
 button(panel,'Retirer ce nœud',()=>panel.remove());nodeReaders.push({panel,read:()=>({id:id.value,type:type.value,body:body.value,buttonLabel:buttonLabel.value,condition:readCondition(),otherwise:readOtherwise(),next:type.value==='text'?readNext():null,options:type.value==='text'?[]:readers.filter(r=>r.panel.isConnected).map(r=>r.read())})});
 }
 definition.nodes.forEach(addNode);
 form.querySelector('[data-add-node]').addEventListener('click',()=>{if(nodeReaders.filter(r=>r.panel.isConnected).length>=40){error.textContent='Maximum 40 nœuds.';return;}addNode({id:'node_'+crypto.randomUUID().slice(0,8),type:'button',body:'',options:[]});});
 form.addEventListener('submit',event=>{const nodes=nodeReaders.filter(r=>r.panel.isConnected).map(r=>r.read());if(!nodes.some(n=>n.id===entry.value.trim())){event.preventDefault();error.textContent='Le nœud initial doit exister.';return;}source.value=JSON.stringify({entry:entry.value.trim(),nodes});});
})();
