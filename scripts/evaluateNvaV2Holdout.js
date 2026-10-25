// Run with the isolation guard. No application database or transport required.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const {detectIntents,normalize}=require('../src/services/whatsappCommercialIntents');
const corpusPath=process.argv[3]?path.resolve(process.argv[3]):path.join(__dirname,'../tests/fixtures/nvaCommercialHoldout.cjs');
const corpus=require(corpusPath);
const development=require('../tests/fixtures/nvaCommercialEvaluation.cjs');
const previousCorpora=process.argv[3]?[...development,...require('../tests/fixtures/nvaCommercialHoldout.cjs'),...(path.basename(corpusPath)==='nvaReliabilityAcceptanceHoldout.cjs'?require('../tests/fixtures/nvaReliabilityFinalHoldout.cjs'):[])]:development;
const previous=new Set(previousCorpora.map(x=>normalize(x.text)));
const seen=new Set();const overlap=[];const duplicates=[];
let exact=0,tp=0,fp=0,fn=0;const perIntent={},confusions={},failures=[];
for(const [index,item] of corpus.entries()){
 const key=normalize(item.text);if(previous.has(key))overlap.push(index);if(seen.has(key))duplicates.push(index);seen.add(key);
 const actual=[...new Set(detectIntents(item.text,item.context))].sort();const expected=[...item.intents].sort();
 const correct=JSON.stringify(actual)===JSON.stringify(expected);if(correct)exact++;
 for(const label of new Set([...actual,...expected])){
  const row=perIntent[label]||={tp:0,fp:0,fn:0,support:0};
  if(expected.includes(label))row.support++;
  if(actual.includes(label)&&expected.includes(label)){row.tp++;tp++;}
  else if(actual.includes(label)){row.fp++;fp++;}
  else {row.fn++;fn++;}
 }
 if(!correct){failures.push({index,text:item.text,expected,actual,context:item.context||null});
  for(const missed of expected.filter(x=>!actual.includes(x)))for(const extra of actual.filter(x=>!expected.includes(x)))confusions[missed+' → '+extra]=(confusions[missed+' → '+extra]||0)+1;
 }
}
for(const row of Object.values(perIntent)){row.precision=row.tp/(row.tp+row.fp)||0;row.recall=row.tp/(row.tp+row.fn)||0;}
const contextual=corpus.map((x,i)=>({...x,index:i})).filter(x=>x.context);
const clarification=corpus.map((x,i)=>({...x,index:i})).filter(x=>x.clarification);
const critical=corpus.map((x,i)=>({...x,index:i})).filter(x=>x.critical);
const criticalErrors=failures.filter(f=>f.expected.includes('REFUSAL')&&f.actual.some(x=>x.startsWith('REGISTRATION'))||f.expected.includes('REGISTRATION_WHATSAPP')&&f.actual.includes('REGISTRATION_WEBSITE')||f.expected.includes('REGISTRATION_WEBSITE')&&f.actual.includes('REGISTRATION_WHATSAPP'));
const result={corpus:path.relative(process.cwd(),corpusPath),corpusSha256:crypto.createHash('sha256').update(fs.readFileSync(corpusPath)).digest('hex'),
 classifierSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../src/services/whatsappCommercialIntents.js'))).digest('hex'),
 total:corpus.length,exact,exactAccuracy:exact/corpus.length,microPrecision:tp/(tp+fp),microRecall:tp/(tp+fn),
 microF1:2*tp/(2*tp+fp+fn),truePositives:tp,falsePositives:fp,falseNegatives:fn,critical:{total:critical.length,failures:failures.filter(x=>critical.some(y=>y.index===x.index)).length},unknownPredictions:corpus.filter(x=>detectIntents(x.text,x.context).includes('UNKNOWN')).length,
 missedKnownAsUnknown:failures.filter(x=>x.actual.includes('UNKNOWN')&&!x.expected.includes('UNKNOWN')).length,
 contextual:{total:contextual.length,failures:failures.filter(x=>contextual.some(y=>y.index===x.index)).length},
 clarification:{total:clarification.length,returnedUnknown:clarification.filter(x=>detectIntents(x.text,x.context).includes('UNKNOWN')).length},
 overlapWithDevelopment:overlap,duplicates,perIntent,confusions,criticalErrors,failures};
if(corpus.length<200||overlap.length||duplicates.length)throw Error('Invalid independent corpus: '+JSON.stringify({overlap,duplicates,total:corpus.length}));
const target=process.argv[2]||'output/nva-v2-holdout-results.json';fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,perIntent:undefined,confusions:undefined,failures:undefined}));
