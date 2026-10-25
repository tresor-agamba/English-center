const fs=require('node:fs');
const baseline=require('../output/nva-v2-holdout-final.json');
if(baseline.exact!==127||baseline.total!==216||baseline.failures.length!==89)throw Error('Unexpected historical baseline');
function explain(f){
 if(f.context)return ['Dialogue contextuel','Le choix ordinal était reconnu par une expression courte ancrée, sans variantes de verbe, genre ou politesse.','Résoudre les ordinaux uniquement dans la sélection de méthode ; donner priorité aux refus.'];
 if(['GREETING','MAIN_MENU','THANKS','GOODBYE'].includes(f.expected[0]))return ['Formules conversationnelles','Ancrage sur une formule courte ou absence de variantes de salutation, retour et politesse.','Reconnaître des unités lexicales et des cadres de commande ; conserver la priorité des questions métier.'];
 if(f.actual.includes('SESSION_START_DATE')&&!f.expected.includes('SESSION_START_DATE'))return ['Frontières lexicales','Les sous-chaînes debut/commenc activaient une date dans débutant, recommencer ou une inscription.','Borner les mots et vérifier le cadre temporel ; exclure les données de niveau et les commandes.'];
 if(f.expected.includes('TRAINING_INFORMATION')&&f.actual.includes('TEACHING_METHOD'))return ['Frontières lexicales','enseign était trouvé dans renseignements.','Chercher les familles enseigner/professeur sur des frontières de mots.'];
 if(f.expected.includes('CERTIFICATE_COST'))return ['Spécialisation certificat','Le coût du document était confondu avec le paiement du cours, le prix général ou la certification.','Combiner le référent certificat/attestation avec les marqueurs monétaires ; isoler les clauses distinctes.'];
 if(f.expected.includes('TRAINING_LIST'))return ['Catalogue et information','Le catalogue n’était reconnu que par quelques formulations ; formation prenait la priorité.','Combiner le pluriel cours/formations avec liste, comparaison, offre et programmes.'];
 if(f.expected.includes('HUMAN_ADVISOR'))return ['Escalade sensible','Responsable/personne réelle ou incident de paiement non reconnu comme demande humaine.','Priorité aux cadres de contact et problèmes administratifs/paiement ; ne pas proposer un simple tarif.'];
 if(f.expected.some(x=>x.startsWith('REGISTRATION')))return ['Parcours inscription','Dépendance à l’ordre des mots et absence de distinction suffisante entre inscription, méthode et suivi.','Séparer intention d’inscription, canal choisi, suivi et réponse courte contextualisée.'];
 if(f.actual.includes('UNKNOWN'))return ['Couverture sémantique','Absence de synonymes ou de cadre composé pour cette formulation.','Ajouter des familles lexicales bornées et des combinaisons de référent/action ; clarifier sans sujet explicite.'];
 return ['Chevauchement de sujets','Un mot de contexte était interprété comme une deuxième question ou masquait le sujet attendu.','Spécialiser les marqueurs coût/durée/horaire et différencier mentions de contexte et demandes multiples.'];
}
const rows=baseline.failures.map(f=>{const [category,cause,correction]=explain(f);return {...f,category,cause,correction};});
const groups={};for(const row of rows)groups[row.category]=(groups[row.category]||0)+1;
fs.writeFileSync('output/nva-v2-reliability-failure-analysis.json',JSON.stringify({source:'output/nva-v2-holdout-final.json',total:89,groups,errors:rows},null,2)+'\n');
const cell=s=>String(s).replace(/\|/g,'/').replace(/\n/g,' ');
const lines=['# Analyse des 89 échecs historiques NVA V2','', 'Source figée : 127/216, avant corrections. Les attendus ne sont pas modifiés. Ce corpus devient un corpus de développement pour cette mission.','',...Object.entries(groups).map(([name,n])=>'- '+name+' : '+n), '', '| Index | Question originale | Attendu | Détecté auparavant | Catégorie | Cause probable | Correction architecturale |','| --- | --- | --- | --- | --- | --- | --- |',...rows.map(r=>'| '+[r.index,r.text,r.expected.join(', '),r.actual.join(', '),r.category,r.cause,r.correction].map(cell).join(' | ')+' |')];
fs.writeFileSync('docs/nva-whatsapp-v2-failure-analysis.md',lines.join('\n')+'\n');console.log(JSON.stringify({errors:rows.length,groups}));
