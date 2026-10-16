#!/usr/bin/env node
/* Testsvit för schemamotorn i index.html.
   Kör:  node tests/run.js            (alla scenarier, 2 slumpfrön)
         node tests/run.js --quick    (färre iterationer, snabb kontroll)
         node tests/run.js --only=helg (bara scenarier vars namn innehåller "helg")
         node tests/run.js --seeds=6  (fler slumpfrön, för att jämföra vikter säkrare)
         node tests/run.js --weights='{"away":40}'  (prova andra vikter utan att ändra index.html)
   Avslutas med felkod 1 om någon hård regel bryts eller om ett scenario hamnar under sina kvalitetsgränser.
   Resultat sparas i tests/results.json (eller --out=fil).
   Motorn är generell: avdelningar, grupper, passtyper, bemanning, regler och personliga begränsningar
   kommer från inställningarna. Scenarierna prövar demodatan, andra upplägg och andra regler,
   plus slumpade konfigurationer som stresstest. */
'use strict';
const fs=require('fs'),path=require('path');

const args=process.argv.slice(2);
const QUICK=args.includes('--quick');
const ONLY=(args.find(a=>a.startsWith('--only='))||'').slice(7).toLowerCase();
const NSEED=+((args.find(a=>a.startsWith('--seeds='))||'').slice(8))||0;
const SEEDS=NSEED?Array.from({length:NSEED},(_,i)=>11+i*18):QUICK?[11]:[11,29];
const ITERS=+((args.find(a=>a.startsWith('--iters='))||'').slice(8))||(QUICK?600000:null); // null = motorns standard
const WEIGHTS=JSON.parse((args.find(a=>a.startsWith('--weights='))||'--weights={}').slice(10));
const STARTS=+((args.find(a=>a.startsWith('--starts='))||'').slice(9))||1;   // flera försök med delad tid, det bästa behålls
const OUT=(args.find(a=>a.startsWith('--out='))||'').slice(6)||path.join(__dirname,'results.json');

/* ---------- ladda motorn ur index.html ---------- */
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const m=html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if(!m){console.error('Hittar inte <script id="engine"> i index.html');process.exit(2);}
// Motorn skrivs till en tillfällig modul och laddas med require. Det är mycket snabbare än vm-sandlådan.
const os=require('os');
const tmp=path.join(os.tmpdir(),'schemaplaneraren-engine-'+process.pid+'.js');
fs.writeFileSync(tmp,m[1]+`
module.exports={defaults,blank,normalize,buildModel,computeAll,strictLaw,greedyFill,trySwap,finish,warmStart,extract,analyze,parseCode,hm,spanMin,W,WG,
  get M(){return M},setRNG(r){RNG=r},mulberry32};`);
const E=require(tmp);fs.unlinkSync(tmp);
Object.assign(E.W,WEIGHTS);

/* ---------- körning ---------- */
function solve(S,seed){
  E.setRNG(E.mulberry32(seed));
  const t0=Date.now(),it=Math.round((ITERS||S.settings.iterations)/STARTS);let best=null;
  for(let k=0;k<STARTS;k++){
    E.buildModel(S);E.computeAll();E.greedyFill();
    for(let i=0;i<it;i++)E.trySwap(60*Math.pow(.3/60,i/it));
    E.strictLaw();E.greedyFill();for(let i=0;i<40000;i++)E.trySwap(.05);E.finish();
    if(!best||E.M.total<best.total)best={total:E.M.total,rows:E.extract()};}
  if(STARTS>1){E.buildModel(S);E.warmStart(best.rows);E.strictLaw();}
  return {A:E.analyze(),ms:Date.now()-t0};
}

/* ---------- oberoende kontroller (räknar själva ur inställningarna, litar inte på motorns tabeller) ---------- */
function independentChecks(S){
  const M=E.M,N=M.N,st=S.settings,R=st.rules,errors=[];
  const unitOf={},gIds=new Set();st.units.forEach(u=>u.groups.forEach(g=>{unitOf[g.id]=u.id;gIds.add(g.id);}));
  const tById={};st.types.forEach(t=>tById[t.id]=t);
  const sched=E.extract();
  for(let p=0;p<M.P;p++){
    const x=S.staff[p],name=x.name,L=S.locks[x.id]||{},row=sched[x.id]||{};
    if(M.staff[p].id!==x.id){errors.push('personordningen stämmer inte');break;}
    const iv=[];
    for(let d=0;d<N;d++){const code=row[d];if(!code)continue;const c=E.parseCode(code);
      if(!c||!tById[c.t]||!tById[c.t].variants[c.i]){errors.push(`${name}: okänt pass ${code} dag ${d}`);continue;}
      // ett nattpass slutar nästa dag: sluttiden räknas som över 24:00
      const vt=tById[c.t].variants[c.i],a=E.hm(vt[0]),b=a+E.spanMin(vt[0],vt[1]),locked=L[d]!==undefined;
      iv.push([d,d*1440+a,d*1440+b]);
      if(!R.night&&a<300)errors.push(`${name}: pass före 05 dag ${d}`);
      if(!R.night&&b>1440)errors.push(`${name}: pass efter midnatt dag ${d}`);
      if(!c.g||!gIds.has(c.g)){errors.push(`${name}: pass utan giltig grupp dag ${d}`);continue;}
      if(!locked){
        // grupp: hemgruppen eller en tillåten grupp i samma avdelning, aldrig en annan avdelning
        if(unitOf[c.g]!==unitOf[x.group])errors.push(`${name}: flyttad till annan avdelning utan att chefen låst det, dag ${d}`);
        else if(c.g!==x.group&&x.groups&&!x.groups.includes(c.g))errors.push(`${name}: i en grupp personen inte får jobba i, dag ${d}`);
        // passtyp och tider
        if(x.types&&!x.types.includes(c.t))errors.push(`${name}: passtyp ${tById[c.t].name} som personen inte tar, dag ${d}`);
        if(x.earliest&&a<E.hm(x.earliest))errors.push(`${name}: börjar före ${x.earliest} dag ${d}`);
        if(x.latest&&b>E.hm(x.latest))errors.push(`${name}: slutar efter ${x.latest} dag ${d}`);
        if(x.maxLen&&b-a>x.maxLen)errors.push(`${name}: pass längre än ${x.maxLen} min dag ${d}`);
      }}
    const lockedAt=d=>L[d]!==undefined;
    // dygnsvila enligt inställningen (lagens 11 h som standard) mellan pass, även över periodskiftet
    for(let i=0;i<iv.length;i++){const a=iv[i],b=iv[(i+1)%iv.length];if(iv.length<2)break;
      const gap=(i+1<iv.length?b[1]:b[1]+N*1440)-a[2];
      if(gap<R.dailyRest*60&&!(lockedAt(a[0])&&lockedAt(b[0])))errors.push(`${name}: dygnsvila ${(gap/60).toFixed(1)} h dag ${a[0]}→${b[0]}`);}
    // veckovila enligt inställningen (lagens 36 h som standard) inom varje kalendervecka
    const all=[];iv.forEach(([,a,b])=>{all.push([a,b],[a-N*1440,b-N*1440],[a+N*1440,b+N*1440]);});all.sort((x,y)=>x[0]-y[0]);
    for(let w=0;w<M.WK;w++){const ws=w*10080,we=ws+10080;let best=0,cur=ws;
      for(const [a,b] of all){if(b<=ws)continue;if(a>=we)break;if(a>cur)best=Math.max(best,Math.min(a,we)-cur);cur=Math.max(cur,b);}
      if(cur<we)best=Math.max(best,we-cur);
      if(best<R.weeklyRest*60)errors.push(`${name}: veckovila ${(best/60).toFixed(1)} h vecka ${w+1}`);}
    // helgrytmen: helglag k arbetar helgerna i vecka k, k+E, ...; inga pass under ledig helg om det inte är låst
    const team=E.WG.indexOf(x.wg)%R.wkEvery;
    for(let w=0;w<M.WK;w++){if(w%R.wkEvery===team)continue;[w*7+5,w*7+6].forEach(d=>{if(row[d]&&!lockedAt(d))errors.push(`${name}: pass under ledig helg dag ${d}`);});}
    // låsningar respekteras, inklusive grupp
    Object.entries(L).forEach(([d,code])=>{d=+d;if(d>=N)return;
      if(code==='-'){if(row[d])errors.push(`${name}: låst ledig men har pass dag ${d}`);return;}
      const want=E.parseCode(code),got=E.parseCode(row[d]);
      if(!got||got.k!==want.k)errors.push(`${name}: låst ${code} men har ${row[d]||'ledigt'} dag ${d}`);
      else if(want.g&&got.g!==want.g)errors.push(`${name}: låst grupp ${want.g} men ligger i ${got.g} dag ${d}`);});
  }
  // en person kan bara ha ett pass per dag, och varje plats bara en person
  const seen=new Set();for(let s=0;s<M.nS;s++){const p=M.slotP[s];if(p<0)continue;const k=p+'|'+M.slots[s].d;if(seen.has(k))errors.push(`dubbelbokning ${k}`);seen.add(k);}
  if(!isFinite(M.total))errors.push('poängen är inte ett tal (NaN)');
  return errors;
}

/* ---------- mått ---------- */
function metrics(S,A){
  const M=E.M,P=M.P,N=M.N;
  const prefShare=pref=>{const ps=A.persons.filter((x,p)=>M.staff[p].pref===pref&&x.n);return ps.length?ps.reduce((a,x)=>a+x.ev/x.n,0)/ps.length:null;};
  let wishT=0,wishOk=0;for(let i=0;i<P*N;i++)if(M.wish[i]){wishT++;if(M.row[Math.floor(i/N)][i%N]<0)wishOk++;}
  const devs=A.persons.map(x=>Math.abs(x.mins-x.target));
  // Vila runt ledigheten, räknad direkt ur schemat.
  let edges=0,edgeMin=0,early=0,late=0;
  for(let p=0;p<P;p++){const row=M.row[p];if(!row.some(v=>v>=0))continue;
    for(let d=0;d<N;d++){const v=row[d];if(v<0)continue;
      if(row[(d+1)%N]<0){let e=(d+1)%N;while(row[e]<0)e=(e+1)%N;const w=row[e];
        edges++;edgeMin+=(1440-M.sh.en[v])+M.sh.st[w];if(M.sh.en[v]<=15*60)early++;if(M.sh.st[w]>=13*60)late++;}}}
  // Lediga helger: vila från sista passet före lördag till första passet efter söndag.
  let wkN=0,wkMin=0;
  for(let p=0;p<P;p++){const row=M.row[p];if(!row.some(v=>v>=0))continue;
    for(let w=0;w<M.WK;w++){const sa=w*7+5;if(row[sa]>=0||row[sa+1]>=0)continue;
      let b=(sa+N-1)%N,k=0;while(row[b]<0&&k++<N)b=(b+N-1)%N;let a=(sa+2)%N;k=0;while(row[a]<0&&k++<N)a=(a+1)%N;
      const dist=((sa-b+N)%N)+((a-sa-2+N)%N)+1;
      wkN++;wkMin+=(1440-M.sh.en[row[b]])+M.sh.st[row[a]]+(dist-1)*1440;}}
  // Sexdagarsveckor och långa arbetsperioder (cykliskt).
  let six=0,runs6=0,runs7=0;
  for(let p=0;p<P;p++){const row=M.row[p];
    for(let w=0;w<M.WK;w++){let c=0;for(let d=w*7;d<w*7+7;d++)if(row[d]>=0)c++;if(c>=6)six++;}
    let f=-1;for(let d=0;d<N;d++)if(row[d]<0){f=d;break;}if(f<0)continue;
    let run=0;for(let k=1;k<=N;k++){const d=(f+k)%N;if(row[d]>=0)run++;else{if(run>=6)runs6++;if(run>=7)runs7++;run=0;}}}
  return {
    personal:P, timmarOk:A.hoursOk, maxAvvikelseMin:P?Math.max(...devs):0,
    vakantVardag:A.holesWd, vikarieHelg:A.holesWe,
    blockPct:Math.round(A.blockPct*1000)/10, maxDagarIRad:A.maxRun,
    ensammaLediga:A.persons.reduce((a,x)=>a+x.singles,0),
    onskemal:`${wishOk}/${wishT}`,
    kvallsandelDag:prefShare('dag'), kvallsandelKvall:prefShare('kvall'), kvallsandelInga:prefShare(''),
    utanforHemgrupp:A.totN?Math.round(A.totAway/A.totN*1000)/10:0,
    sexdagarsveckor:six, perioder6:runs6, perioder7:runs7,
    helgVilaH:wkN?Math.round(wkMin/wkN/6)/10:null,
    vilaRuntLedighetH:edges?Math.round(edgeMin/edges/6)/10:null, slutarTidigtFore:edges?Math.round(early/edges*100):null, borjarSentEfter:edges?Math.round(late/edges*100):null,
    kapacitet:A.capacity,
  };
}

/* ---------- byggstenar för scenarier ---------- */
const base=()=>E.defaults();
const groupsOf=S=>S.settings.units.flatMap(u=>u.groups.map(g=>g.id));
const setAll=(S,f)=>{S.staff.forEach(f);return S;};
// ersätter personalen i en grupp med nya personer med givna tjänstgöringsgrader
const makeGroup=(S,gid,pcts,extra)=>{S.staff=S.staff.filter(x=>x.group!==gid);
  pcts.forEach((pct,i)=>S.staff.push(Object.assign({id:gid+'x'+i,name:`${gid.toUpperCase()} ${i+1}`,group:gid,pct,wg:i%2?'B':'A',pref:'',types:null,earliest:null,latest:null,maxLen:null,groups:null},extra?extra(i):{})));return S;};
const setDemand=(S,f)=>{groupsOf(S).forEach(g=>['weekday','weekend'].forEach(w=>S.settings.types.forEach(t=>{S.settings.demand[g]=S.settings.demand[g]||{weekday:{},weekend:{}};
  S.settings.demand[g][w]=S.settings.demand[g][w]||{};S.settings.demand[g][w][t.id]=f(g,w,t);})));return S;};
const P14=[100,100,90,90,85,85,80,80,75,75,75,75,65,50];
// enkel slumpgenerator för de slumpade konfigurationerna (oberoende av motorns frö)
function rng(seed){let a=seed;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const t2=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function randomConfig(seed){
  const R=rng(seed),ri=(a,b)=>a+Math.floor(R()*(b-a+1)),pick=a=>a[Math.floor(R()*a.length)];
  const nU=ri(1,3),units=[];let g=0;
  for(let u=0;u<nU;u++){const gs=[];for(let k=0,n=ri(1,3);k<n;k++){g++;gs.push({id:'g'+g,name:'G'+g});}units.push({id:'u'+(u+1),name:'Avd '+(u+1),groups:gs});}
  const nT=ri(2,5),types=[];
  for(let t=0;t<nT;t++){const vs=[];const startBase=ri(20,58)*15;  // 05:00–14:30
    for(let k=0,n=ri(1,6);k<n;k++){const a=startBase+ri(0,6)*15,len=ri(12,33)*15;const b=Math.min(1440,a+len);if(b>a)vs.push([t2(a),t2(b)]);}
    types.push({id:'t'+(t+1),name:'Typ '+(t+1),color:'#'+(0x400000+ri(0,0xbfffff)).toString(16),eve:R()<.4,variants:vs});}
  const S=base();S.example=false;S.settings.units=units;S.settings.types=types;S.settings.demand={};
  S.settings.weeks=pick([4,6,8]);S.settings.fullTime=pick([35,37,38.25,40]);S.settings.rules.fillWeekend=R()<.2;
  S.settings.rules.wkEvery=pick([2,2,3,4]);S.settings.rules.lend=pick(['behov','behov','aldrig','fritt']);S.settings.rules.maxWeekDays=pick([5,5,6]);
  // ibland nattpass: en passtyp får en tid över midnatt
  if(R()<.3){S.settings.rules.night=true;types[0].variants.push([t2(ri(84,88)*15),t2(ri(26,30)*15)]);}
  units.forEach(u=>u.groups.forEach(gr=>{S.settings.demand[gr.id]={weekday:{},weekend:{}};types.forEach(t=>{S.settings.demand[gr.id].weekday[t.id]=ri(0,3);S.settings.demand[gr.id].weekend[t.id]=ri(0,2);});}));
  S.staff=[];let n=0;
  units.forEach(u=>u.groups.forEach(gr=>{for(let k=0,c=ri(0,16);k<c;k++){n++;const others=u.groups.filter(x=>x.id!==gr.id).map(x=>x.id);
    S.staff.push({id:'r'+n,name:'Person '+n,group:gr.id,pct:pick([100,90,80,75,60,50,25]),wg:pick(['A','B','C','D']),pref:pick(['','','dag','kvall']),
      types:R()<.2?types.filter(()=>R()<.6).map(t=>t.id):null,earliest:R()<.1?t2(ri(24,40)*15):null,latest:R()<.1?t2(ri(48,88)*15):null,
      maxLen:R()<.08?ri(16,32)*15:null,groups:R()<.25?others.filter(()=>R()<.5):null});}}));
  S.wishes={};S.staff.forEach(x=>{if(R()<.2){S.wishes[x.id]={};S.wishes[x.id][ri(0,S.settings.weeks*7-1)]='L';}});
  S.locks={};S.staff.forEach(x=>{if(R()<.1){const t=pick(types),i=ri(0,t.variants.length-1),d=ri(0,S.settings.weeks*7-1);if(t.variants.length&&d%7<5)S.locks[x.id]={[d]:`${t.id}.${i}@${x.group}`};}});
  return S;
}

/* ---------- scenarier ---------- */
const SCEN=[
  // gate: kvalitetsgränser som varje körning måste klara (gäller inte snabbläget, som kör färre iterationer)
  {name:'Standard (demodata, 4 grupper × 14)',make:()=>base(),
    gate:{timmarMiss:1,maxAvvikelseMin:30,vakantVardag:0,perioder7:1,vikarieHelg:72,utanforHemgrupp:12}},
  {name:'Alla heltid',make:()=>setAll(base(),x=>x.pct=100)},
  {name:'Mest deltid (50–60 %)',make:()=>setAll(base(),(x,i)=>x.pct=i%2?50:60)},
  {name:'Underbemannat: 10 per grupp',make:()=>{const S=base();groupsOf(S).forEach(g=>makeGroup(S,g,[100,90,80,80,75,75,75,65,60,50]));return S;}},
  {name:'Överbemannat: 18 per grupp',make:()=>{const S=base();groupsOf(S).forEach(g=>makeGroup(S,g,[100,100,90,90,85,80,80,75,75,75,75,70,65,65,60,60,50,50]));return S;}},
  {name:'Obalanserade helggrupper (10 udda, 4 jämna)',make:()=>setAll(base(),(x,i)=>x.wg=(i%14)<10?'A':'B')},
  {name:'Alla vill hellre dag',make:()=>setAll(base(),x=>x.pref='dag')},
  {name:'Alla vill hellre kväll',make:()=>setAll(base(),x=>x.pref='kvall')},
  {name:'Blandade preferenser (en tredjedel var)',make:()=>setAll(base(),(x,i)=>x.pref=['dag','kvall',''][i%3])},
  {name:'Många önskemål om ledighet (3 per person)',make:()=>{const S=base();S.wishes={};S.staff.forEach((x,i)=>{S.wishes[x.id]={};[i%5,7+(i*3)%5,21+(i*2)%5].forEach(d=>S.wishes[x.id][d]='L');});return S;}},
  {name:'Krockande önskemål (alla vill ledigt fredag vecka 2)',make:()=>{const S=base();S.wishes={};S.staff.forEach(x=>S.wishes[x.id]={'11':'L'});return S;}},
  {name:'Grundschema 4 veckor',make:()=>{const S=base();S.settings.weeks=4;return S;}},
  {name:'Grundschema 8 veckor',make:()=>{const S=base();S.settings.weeks=8;return S;}},
  {name:'Kortare heltid: 35 h',make:()=>{const S=base();S.settings.fullTime=35;return S;}},
  {name:'Längre heltid: 40 h',make:()=>{const S=base();S.settings.fullTime=40;return S;}},
  {name:'Fyll även helger med ordinarie',make:()=>{const S=base();S.settings.rules.fillWeekend=true;return S;}},
  {name:'Bara egen grupp (ingen får lånas ut)',make:()=>setAll(base(),x=>x.groups=[]),gate:{utanforHemgrupp:0,vakantVardag:0}},
  {name:'Bara en avdelning (avdelning 2 borttagen)',make:()=>{const S=base();S.settings.units=S.settings.units.slice(0,1);S.staff=S.staff.filter(x=>x.group==='g1'||x.group==='g2');return S;}},
  {name:'En avdelning med tre grupper',make:()=>{const S=base();S.settings.units=[{id:'u1',name:'Avdelningen',groups:[{id:'g1',name:'Norr'},{id:'g2',name:'Söder'},{id:'g3',name:'Väster'}]}];
    S.staff=S.staff.filter(x=>x.group!=='g4');return S;}},
  {name:'En grupp per avdelning',gate:{timmarMiss:1,vakantVardag:0},make:()=>{const S=base();S.settings.units=[{id:'u1',name:'Avdelning 1',groups:[{id:'g1',name:'Avdelning 1'}]},{id:'u2',name:'Avdelning 2',groups:[{id:'g3',name:'Avdelning 2'}]}];
    S.staff=S.staff.filter(x=>x.group==='g1'||x.group==='g3');return S;}},
  {name:'Egna passtyper (morgon, dag, kväll)',make:()=>{const S=base();S.settings.types=[
      {id:'m',name:'Morgon',color:'#f1a238',eve:false,variants:[['06:00','12:00'],['06:00','14:00'],['07:00','12:00'],['06:30','14:30']]},
      {id:'d',name:'Dag',color:'#f8dcae',eve:false,variants:[['08:00','16:00'],['08:00','16:15'],['09:00','15:00']]},
      {id:'k',name:'Kväll',color:'#3b5b8c',eve:true,variants:[['14:00','21:30'],['15:00','22:00'],['16:00','22:00']]}];
    setDemand(S,(g,w,t)=>({m:2,d:g==='g1'||g==='g2'?(w==='weekday'?3:2):2,k:4}[t.id]));return S;}},
  {name:'Många tider per passtyp (12 varianter)',make:()=>{const S=base();const vs=[];for(let a=0;a<4;a++)for(let b=0;b<3;b++)vs.push([t2(405+a*15),t2(840+b*30)]);S.settings.types[0].variants=vs;return S;}},
  {name:'Personliga begränsningar',make:()=>{const S=base();
    S.settings.types.push({id:'t5',name:'Förmiddag',color:'#86cfa4',eve:false,variants:[['07:00','11:00'],['07:00','12:00'],['08:00','12:00']]});
    setDemand(S,(g,w,t)=>t.id==='t5'?(w==='weekday'?1:0):S.settings.demand[g][w][t.id]);
    S.staff.forEach((x,i)=>{const k=i%14;
      if(k===2)x.types=['t1','t2','t5'];                 // bara dagtid
      if(k===5){x.latest='15:00';}                       // aldrig kväll
      if(k===7){x.earliest='09:00';}                     // inga tidiga
      if(k===12){x.maxLen=300;x.pct=50;}                 // högst 5 h per pass
      if(k===13){x.types=['t3','t4'];}});                // bara kväll
    return S;}},
  {name:'Manuellt lån till annan avdelning',make:()=>{const S=base();S.locks={};
    // fem från avdelning 2 lånas ut till avdelning 1 på vardagskvällar, och två åt andra hållet
    ['s29','s31','s33','s35','s37'].forEach((id,i)=>S.locks[id]={[String(i*7+2)]:'t4.1@g1'});
    ['s2','s4'].forEach((id,i)=>S.locks[id]={[String(i*7+1)]:'t1.2@g3'});return S;}},
  {name:'Många låsningar (2 pass per person)',make:()=>{const S=base();S.locks={};S.staff.forEach((x,i)=>{const d1=(i*3)%35,d2=(d1+9)%35;const ok=d=>d%7<5;S.locks[x.id]={};
    if(ok(d1))S.locks[x.id][d1]=i%3===0?'t2.1@'+x.group:'t1.1@'+x.group;if(ok(d2))S.locks[x.id][d2]='-';});return S;}},
  {name:'Låsning som bryter vilan (kväll följt av tidigt)',make:()=>{const S=base();S.locks={s1:{'1':'t4.0@g1','2':'t1.0@g1'}};return S;},allowLockedViolations:true,expectFlag:true},
  {name:'Skräpdata och felinmatning',make:()=>{const S=base();S.staff.forEach(x=>x.pct='75%');S.settings.fullTime='37,5';S.settings.types[0].variants[0]=['6.45','14'];
    S.settings.types.push({id:'BAD!',name:'',variants:[['25:00','10'],['abc','']]});S.settings.units.push({name:'Tom',groups:[]});
    S.staff.push(null,{name:'  ',pct:'abc',group:'finnsinte',types:['x'],earliest:'99',maxLen:'lång'});S.locks={s1:{'3':'zz.9@g1','4':'t1.0@nope'}};return S;}},
  // regler som verksamheten ställer in
  {name:'Var tredje helg',make:()=>{const S=base();S.settings.rules.wkEvery=3;S.staff.forEach((x,i)=>x.wg='ABC'[i%3]);return S;}},
  {name:'Var fjärde helg, 8 veckor',make:()=>{const S=base();S.settings.rules.wkEvery=4;S.settings.weeks=8;S.staff.forEach((x,i)=>x.wg='ABCD'[i%4]);return S;}},
  {name:'Nattpass (dag, kväll och natt)',make:()=>{const S=E.blank('',base().settings.units,'natt');S.staff=base().staff;return S;}},
  {name:'Ingen utlåning mellan grupper',make:()=>{const S=base();S.settings.rules.lend='aldrig';return S;},gate:{utanforHemgrupp:0}},
  {name:'Fri utlåning mellan grupper',make:()=>{const S=base();S.settings.rules.lend='fritt';return S;}},
  {name:'Kortare dygnsvila enligt avtal (9 h)',make:()=>{const S=base();S.settings.rules.dailyRest=9;return S;}},
  {name:'Högst 6 arbetsdagar per vecka och 4 i rad',make:()=>{const S=base();S.settings.rules.maxWeekDays=6;S.settings.rules.maxRow=4;return S;}},
  {name:'En grupp utan personal',make:()=>{const S=base();S.staff=S.staff.filter(x=>x.group!=='g4');return S;}},
  {name:'En enda person',make:()=>{const S=base();S.staff=S.staff.slice(0,1);return S;}},
];
for(let k=1;k<=6;k++)SCEN.push({name:`Slumpad konfiguration ${k}`,make:()=>randomConfig(1000+k*77),fuzz:true});

/* ---------- kör ---------- */
const results=[];let hardFail=0,gateFail=0;
// Kvalitetsgränser: returnerar en lista med det som inte nåddes
function checkGate(g,met){if(!g||QUICK)return [];const bad=[];
  if(g.timmarMiss!==undefined&&met.personal-met.timmarOk>g.timmarMiss)bad.push(`${met.personal-met.timmarOk} får inte exakt sina timmar (högst ${g.timmarMiss})`);
  ['maxAvvikelseMin','vakantVardag','perioder7','vikarieHelg','utanforHemgrupp'].forEach(k=>{if(g[k]!==undefined&&met[k]>g[k])bad.push(`${k} ${met[k]} (högst ${g[k]})`);});
  return bad;}
const pad=(s,n)=>String(s).padEnd(n).slice(0,n);
console.log(`Schemamotorn · ${SCEN.length} scenarier · frön ${SEEDS.join(', ')} · ${QUICK?'snabbläge':'full körning'}\n`);
for(const sc of SCEN){
  if(ONLY&&!sc.name.toLowerCase().includes(ONLY))continue;
  for(const seed of SEEDS){
    let S,A,ms,errs,met;
    try{S=E.normalize(sc.make());({A,ms}=solve(S,seed));errs=independentChecks(S);met=metrics(S,A);}
    catch(e){console.log(`✗ ${sc.name} (frö ${seed}): KRASCH ${e.stack}`);hardFail++;results.push({scenario:sc.name,seed,crash:e.message});continue;}
    const flagged=A.dailyV+A.weeklyV>0;
    let ok=errs.length===0;
    if(sc.allowLockedViolations)ok=errs.every(e=>/dygnsvila|veckovila/.test(e));   // lagbrott som chefen själv låst in räknas inte som motorfel…
    if(sc.expectFlag&&!flagged){ok=false;errs.push('motorn flaggade inte det inlåsta vilobrottet');} // …men måste visas
    if(!ok)hardFail++;
    const gateBad=checkGate(sc.gate,met);if(gateBad.length)gateFail++;
    results.push({scenario:sc.name,seed,ms,ok,gate:gateBad,errors:errs.slice(0,10),...met});
    console.log(`${ok?(gateBad.length?'△':'✓'):'✗'} ${pad(sc.name,52)} ${String(ms).padStart(5)} ms | timmar ${met.timmarOk}/${met.personal} (max ${met.maxAvvikelseMin} min) | vakant vard ${met.vakantVardag} helg ${met.vikarieHelg} | block ${met.blockPct}% | max ${met.maxDagarIRad} d i rad | önskemål ${met.onskemal} | utanför hemgrupp ${met.utanforHemgrupp} % | ledig helg ${met.helgVilaH} h | 6-dagarsveckor ${met.sexdagarsveckor} | 6+ i rad ${met.perioder6}, 7+ ${met.perioder7}`);
    if(!sc.fuzz&&(met.kvallsandelDag!==null||met.kvallsandelKvall!==null))console.log(`    kvällsandel: hellre dag ${fmtP(met.kvallsandelDag)}, hellre kväll ${fmtP(met.kvallsandelKvall)}, inga ${fmtP(met.kvallsandelInga)}`);
    (A.todo||[]).filter(i=>i.p<0&&/timmar per vecka/.test(i.text)).forEach(i=>console.log('    → '+i.text));
    errs.slice(0,3).forEach(e=>console.log('    ! '+e));
    gateBad.forEach(e=>console.log('    △ under kvalitetsgränsen: '+e));
  }
}
function fmtP(x){return x===null?'–':Math.round(x*100)+' %';}
fs.writeFileSync(OUT,JSON.stringify(results,null,1));
console.log(`\n${hardFail?'✗ '+hardFail+' körningar bröt mot hårda regler':'✓ Inga hårda regler bröts'}${gateFail?` · △ ${gateFail} körningar under kvalitetsgränserna`:QUICK?'':' · alla kvalitetsgränser nåddes'} · resultat i ${path.relative(process.cwd(),OUT)||OUT}`);
process.exit(hardFail||gateFail?1:0);
