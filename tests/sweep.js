#!/usr/bin/env node
/* Jämför vikter i motorn utan att ändra index.html. Kör testsviten för varje uppsättning och visar snitt.
   Exempel:
     node tests/sweep.js --only=standard --seeds=4 '{}' '{"wkMiss":1200}' '{"wkMiss":200,"sixWeek":300}'
   Varje argument som är JSON är en uppsättning vikter som läggs ovanpå motorns standard. */
'use strict';
const {execFileSync}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const args=process.argv.slice(2);
const pass=args.filter(a=>a.startsWith('--'));
const sets=args.filter(a=>!a.startsWith('--'));if(!sets.length)sets.push('{}');
const out=path.join(os.tmpdir(),'sweep-'+process.pid+'.json');
const avg=(xs,k)=>xs.reduce((a,x)=>a+(+x[k]||0),0)/(xs.length||1);
const cols=[['timmarOk','timmar ok'],['vakantVardag','vakant vard'],['vikarieHelg','helg vik'],['sexdagarsveckor','6-dagarsv'],['perioder7','7 i rad'],
  ['utanforHemgrupp','utanför %'],['helgVilaH','ledig helg h'],['blockPct','block %']];
console.log(['vikter'.padEnd(36),...cols.map(c=>c[1].padStart(12))].join(''));
for(const w of sets){
  try{execFileSync('node',[path.join(__dirname,'run.js'),...pass,`--weights=${w}`,`--out=${out}`],{stdio:'ignore'});}catch(e){/* felkod vid brutna gränser, resultat finns ändå */}
  const r=JSON.parse(fs.readFileSync(out,'utf8')).filter(x=>!x.crash);
  const bad=r.filter(x=>!x.ok).length;
  console.log([w.slice(0,35).padEnd(36),...cols.map(c=>avg(r,c[0]).toFixed(1).padStart(12))].join('')+(bad?`   ✗ ${bad} bröt hårda regler`:''));
}
try{fs.unlinkSync(out);}catch(e){}
