#!/usr/bin/env node
/* Rättvisemätning för schemamotorn i index.html: hur lika schemat är mellan personerna.
   Kör:  node tests/fair.js                 (demot och två andra upplägg, 2 slumpfrön, 15 miljoner steg som i appen)
         node tests/fair.js --iters=3000000 (kortare sökning, snabb kontroll)
         node tests/fair.js --seeds=4
         node tests/fair.js --weights='{"fairFri":300}'  (prova andra vikter utan att ändra index.html)
   För varje mått skrivs lägsta–högsta värde per person och, inom parentes, hur många som inte har det vanligaste värdet.
   Avslutas med felkod 1 om demot hamnar över gränserna i GATE, så att en ändring som ökar skillnaderna upptäcks. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const args=process.argv.slice(2),arg=(k,d)=>{const a=args.find(x=>x.startsWith('--'+k+'='));return a?a.slice(k.length+3):d;};
const ITERS=+arg('iters',15e6),NSEED=+arg('seeds',2),WEIGHTS=JSON.parse(arg('weights','{}')),ONE=arg('one','');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const tmp=path.join(os.tmpdir(),'fair-eng-'+process.pid+'.js');
fs.writeFileSync(tmp,src+`\nmodule.exports={defaults,normalize,buildModel,computeAll,strictLaw,greedyFill,trySwap,finish,analyze,W,get M(){return M},setRNG(r){RNG=r},mulberry32};`);
const E=require(tmp);fs.unlinkSync(tmp);Object.assign(E.W,WEIGHTS);

const SETUPS={
  demo:{name:'Demot (8,5 h pass, tre dagars långledighet)',make:()=>E.defaults()},
  long:{name:'9 h pass, fyra dagars långledighet',make:()=>{const S=E.defaults();S.settings.shift.max=570;S.settings.longOff=4;return S;}},
  helg:{name:'Demot med helgkurvan 3–4–3',make:()=>{const S=E.defaults();Object.keys(S.settings.curves).forEach(g=>S.settings.curves[g].weekend=[['06:45',2],['07:00',3],['12:00',4],['14:00',3],['21:00',2]]);return S;}}};
// Största tillåtna skillnad mellan högsta och lägsta värde per person i demot.
const GATE={'Arbetsdagar':1,'Kvällspass':3,'Helgpass':0,'Kvällspass på helgen':2,'Fredagskvällar':2,'Måndagsmorgnar':3,'Längsta arbetsperiod, dagar':1,'Längsta ledighet, dagar':1,'Ensamma lediga dagar':1};

function run(key,seed){
  const S=E.normalize(SETUPS[key].make());E.setRNG(E.mulberry32(seed));
  E.buildModel(S);E.computeAll();E.greedyFill();
  for(let i=0;i<ITERS;i++)E.trySwap(60*Math.pow(.3/60,i/ITERS));
  E.strictLaw();E.greedyFill();for(let i=0;i<40000;i++)E.trySwap(.05);E.finish();
  const A=E.analyze();
  return {key,seed,fair:A.fair.map(r=>({paper:r.paper,lo:r.lo,hi:r.hi,off:r.tot-r.same})),hoursOk:A.hoursOk,P:A.persons.length,
    gapWd:Math.round(A.shortWd/6)/10,gapWe:Math.round(A.shortWe/6)/10,hard:A.hard};
}
// Ett barn per körning, så att alla kärnor används.
if(ONE){const [k,s]=ONE.split(':');console.log(JSON.stringify(run(k,+s)));process.exit(0);}
const {spawn}=require('child_process');
const seeds=Array.from({length:NSEED},(_,i)=>11+i*18),jobs=[];
Object.keys(SETUPS).forEach(k=>seeds.forEach(s=>jobs.push(new Promise((res,rej)=>{let out='';
  const c=spawn(process.execPath,[__filename,`--one=${k}:${s}`,`--iters=${ITERS}`,`--weights=${JSON.stringify(WEIGHTS)}`]);
  c.stdout.on('data',d=>out+=d);c.stderr.pipe(process.stderr);c.on('close',code=>code?rej(new Error(`${k}:${s} avslutades med ${code}`)):res(JSON.parse(out)));}))));
Promise.all(jobs).then(rs=>{let bad=0;
  Object.keys(SETUPS).forEach(k=>{const R=rs.filter(r=>r.key===k);
    console.log(`\n${SETUPS[k].name}`);
    console.log('  '+'Mått'.padEnd(30)+R.map(r=>('frö '+r.seed).padEnd(14)).join(''));
    R[0].fair.forEach((f,i)=>{let line='  '+f.paper.padEnd(30),mark='';
      R.forEach(r=>{const x=r.fair[i];line+=(x.lo===x.hi?`${x.lo}`:`${x.lo}–${x.hi} (${x.off})`).padEnd(14);
        if(k==='demo'&&GATE[x.paper]!==undefined&&x.hi-x.lo>GATE[x.paper]){mark=` ✗ högst ${GATE[x.paper]} i skillnad`;bad++;}});
      console.log(line+mark);});
    console.log('  '+'Rätt timmar'.padEnd(30)+R.map(r=>`${r.hoursOk}/${r.P}`.padEnd(14)).join(''));
    console.log('  '+'Lucka vardag / helg, h'.padEnd(30)+R.map(r=>`${r.gapWd} / ${r.gapWe}`.padEnd(14)).join(''));
    R.forEach(r=>{if(r.hard){console.log(`  ✗ frö ${r.seed}: ${r.hard} hårda regelbrott`);bad++;}});});
  console.log(bad?`\n✗ ${bad} avvikelser`:'\n✓ Demot håller rättvisegränserna');process.exit(bad?1:0);
}).catch(e=>{console.error(e);process.exit(2);});
