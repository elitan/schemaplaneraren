#!/usr/bin/env node
/* Testsvit för schemamotorn i index.html.
   Kör:  node tests/run.js            (alla scenarier, 2 slumpfrön)
         node tests/run.js --quick    (färre iterationer, snabb kontroll)
         node tests/run.js --only=helg (bara scenarier vars namn innehåller "helg")
         node tests/run.js --seeds=6  (fler slumpfrön, för att jämföra vikter säkrare)
         node tests/run.js --weights='{"away":40}'  (prova andra vikter utan att ändra index.html)
   Avslutas med felkod 1 om någon hård regel bryts eller om ett scenario hamnar under sina kvalitetsgränser.
   Resultat sparas i tests/results.json (eller --out=fil).
   Motorn är generell: avdelningar, grupper, arbetsdag, bemanningskurvor, regler och personliga begränsningar
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
module.exports={defaults,blank,normalize,buildModel,computeAll,strictLaw,greedyFill,trySwap,finish,warmStart,extract,analyze,parseCode,hm,curveAt,W,WG,DEFAULT_CURVE,DAILY_REST,WEEKLY_REST,BLOCK_WEEKS,
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
function independentChecks(S,A){
  const M=E.M,N=M.N,st=S.settings,R=st.rules,errors=[];
  const unitOf={},gIds=new Set();st.units.forEach(u=>u.groups.forEach(g=>{unitOf[g.id]=u.id;gIds.add(g.id);}));
  const d0=E.hm(st.day.start),d1=E.hm(st.day.end),sched=E.extract();
  const work=[];   // [person, dag, grupp, start, slut] för bemanningen
  for(let p=0;p<M.P;p++){
    const x=S.staff[p],name=x.name,L=S.locks[x.id]||{},row=sched[x.id]||{};
    if(M.staff[p].id!==x.id){errors.push('personordningen stämmer inte');break;}
    const iv=[];
    for(let d=0;d<N;d++){const code=row[d];if(!code)continue;const c=E.parseCode(code);
      if(!c){errors.push(`${name}: okänt pass ${code} dag ${d}`);continue;}
      const a=c.st,b=c.en,locked=L[d]!==undefined;
      iv.push([d,d*1440+a,d*1440+b]);
      if(!c.g||!gIds.has(c.g)){errors.push(`${name}: pass utan giltig grupp dag ${d}`);continue;}
      work.push([p,d,c.g,a,b]);
      if(a<300||b>1440)errors.push(`${name}: pass på natten dag ${d}`);
      if(!locked){
        if(a<d0||b>d1)errors.push(`${name}: pass utanför arbetsdagen dag ${d}`);
        if(b-a<st.shift.min||b-a>st.shift.max)errors.push(`${name}: pass ${b-a} min, utanför ${st.shift.min}–${st.shift.max} dag ${d}`);
        // grupp: hemgruppen eller en tillåten grupp i samma avdelning, aldrig en annan avdelning
        if(unitOf[c.g]!==unitOf[x.group])errors.push(`${name}: flyttad till annan avdelning utan att chefen låst det, dag ${d}`);
        else if(c.g!==x.group&&R.lend==='aldrig')errors.push(`${name}: i en grupp personen inte får jobba i, dag ${d}`);
        if(x.earliest&&a<E.hm(x.earliest))errors.push(`${name}: börjar före ${x.earliest} dag ${d}`);
        if(x.latest&&b>E.hm(x.latest))errors.push(`${name}: slutar efter ${x.latest} dag ${d}`);
        if(x.maxLen&&b-a>x.maxLen)errors.push(`${name}: pass längre än ${x.maxLen} min dag ${d}`);
      }}
    const lockedAt=d=>L[d]!==undefined;
    // dygnsvila 11 h mellan pass, även över periodskiftet
    for(let i=0;i<iv.length;i++){const a=iv[i],b=iv[(i+1)%iv.length];if(iv.length<2)break;
      const gap=(i+1<iv.length?b[1]:b[1]+N*1440)-a[2];
      if(gap<E.DAILY_REST*60&&!(lockedAt(a[0])&&lockedAt(b[0])))errors.push(`${name}: dygnsvila ${(gap/60).toFixed(1)} h dag ${a[0]}→${b[0]}`);}
    // veckovila 36 h inom varje kalendervecka
    const all=[];iv.forEach(([,a,b])=>{all.push([a,b],[a-N*1440,b-N*1440],[a+N*1440,b+N*1440]);});all.sort((x,y)=>x[0]-y[0]);
    for(let w=0;w<M.WK;w++){const ws=w*10080,we=ws+10080;let best=0,cur=ws;
      for(const [a,b] of all){if(b<=ws)continue;if(a>=we)break;if(a>cur)best=Math.max(best,Math.min(a,we)-cur);cur=Math.max(cur,b);}
      if(cur<we)best=Math.max(best,we-cur);
      if(best<E.WEEKLY_REST*60)errors.push(`${name}: veckovila ${(best/60).toFixed(1)} h vecka ${w+1}`);}
    // varannan helg: lag A arbetar udda veckor, lag B jämna; inga pass under ledig helg om det inte är låst
    const team=x.wg==='B'?1:0;
    for(let w=0;w<M.WK;w++){if(w%2===team)continue;[w*7+5,w*7+6].forEach(d=>{if(row[d]&&!lockedAt(d))errors.push(`${name}: pass under ledig helg dag ${d}`);});}
    // låsningar respekteras, inklusive grupp
    Object.entries(L).forEach(([d,code])=>{d=+d;if(d>=N)return;
      if(code==='-'){if(row[d])errors.push(`${name}: låst ledig men har pass dag ${d}`);return;}
      const want=E.parseCode(code),got=E.parseCode(row[d]);
      if(!got||got.k!==want.k)errors.push(`${name}: låst ${code} men har ${row[d]||'ledigt'} dag ${d}`);
      else if(want.g&&got.g!==want.g)errors.push(`${name}: låst grupp ${want.g} men ligger i ${got.g} dag ${d}`);});
  }
  // bemanningen räknad kvart för kvart direkt ur schemat och kurvorna, jämförd med motorns siffra
  let short=0;
  for(let d=0;d<N;d++)st.units.forEach(u=>u.groups.forEach(g=>{const curve=st.curves[g.id][d%7>=5?'weekend':'weekday'];
    for(let t=d0;t<d1;t+=15){const need=E.curveAt(curve,t);let have=0;for(const [,dd,gg,a,b] of work)if(dd===d&&gg===g.id&&a<=t&&b>=t+15)have++;if(have<need)short+=(need-have)*15;}}));
  if(Math.abs(short-(A.shortWd+A.shortWe))>1)errors.push(`bemanningen: ${short} min under kurvan räknat här, motorn säger ${A.shortWd+A.shortWe}`);
  if(!isFinite(M.total))errors.push('poängen är inte ett tal (NaN)');
  return errors;
}

/* ---------- mått ---------- */
function metrics(S,A){
  const M=E.M,P=M.P,N=M.N;
  // rättvisa: helgpass och kvällsandel, minsta och största per person bland dem som har pass
  const act=A.persons.filter(x=>x.n),weN=act.map(x=>x.we),evS=act.map(x=>x.ev/x.n);
  // längsta ledighet i sträck, räknad runt grundschemat, för dem utan låsta lediga dagar
  const offS=[];for(let p=0;p<P;p++){const row=M.row[p];if(!M.offOn[p]||!row.some(v=>v>=0))continue;
    let f=0;while(row[f]<0)f++;let best=0,run=0;for(let k=1;k<=N;k++){if(row[(f+k)%N]<0)best=Math.max(best,++run);else run=0;}offS.push(best);}
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
    luckaVardagH:Math.round(A.shortWd/6)/10, vikarieHelgH:Math.round(A.shortWe/6)/10,
    blockPct:Math.round(A.blockPct*1000)/10, maxDagarIRad:A.maxRun,
    ensammaLediga:A.persons.reduce((a,x)=>a+x.singles,0),
    helgpass:weN.length?`${Math.min(...weN)}–${Math.max(...weN)}`:'–', helgSpridning:weN.length?Math.max(...weN)-Math.min(...weN):0,
    kvallsandel:evS.length?`${Math.round(Math.min(...evS)*100)}–${Math.round(Math.max(...evS)*100)} %`:'–',
    kvallSpridning:evS.length?Math.round((Math.max(...evS)-Math.min(...evS))*100):0, dagSpridning:A.daySpread,
    mittpassPct:(()=>{let a=0,b=0;for(let p=0;p<P;p++)for(let d=0;d<N;d++){const v=M.row[p][d];if(v<0)continue;a++;if(M.sh.mid[v]>60)b++;}return a?Math.round(b/a*1000)/10:0;})(),
    ledigISträck:offS.length?`${Math.min(...offS)}–${Math.max(...offS)}`:'–', ledigSpridning:offS.length?Math.max(...offS)-Math.min(...offS):0,
    utanforHemgrupp:A.totN?Math.round(A.totAway/A.totN*1000)/10:0,
    sexdagarsveckor:six, perioder6:runs6, perioder7:runs7,
    helgVilaH:wkN?Math.round(wkMin/wkN/6)/10:null,
    vilaRuntLedighetH:edges?Math.round(edgeMin/edges/6)/10:null, slutarTidigtFore:edges?Math.round(early/edges*100):null, borjarSentEfter:edges?Math.round(late/edges*100):null,
    kapacitet:A.capacity,
  };
}

/* ---------- byggstenar för scenarier ---------- */
const base=()=>E.defaults();
// Demots helgkurva vill ha 4 i tjänst 07–21. Med varannan helg arbetar 7 av 14, men det behövs 4 som börjar tidigt och 4 som
// slutar sent med pass på högst 9,5 timmar. Det fattas alltså en person per grupp och helgdag, ungefär 4,5 timmar, som går
// till vikarie: cirka 145 timmar på fyra veckor för fyra grupper.
const WEEKEND_GAP=170;
const groupsOf=S=>S.settings.units.flatMap(u=>u.groups.map(g=>g.id));
const setAll=(S,f)=>{S.staff.forEach(f);return S;};
// ersätter personalen i en grupp med nya personer med givna tjänstgöringsgrader
const makeGroup=(S,gid,pcts,extra)=>{S.staff=S.staff.filter(x=>x.group!==gid);
  pcts.forEach((pct,i)=>S.staff.push(Object.assign({id:gid+'x'+i,name:`${gid.toUpperCase()} ${i+1}`,group:gid,pct,wg:i%2?'B':'A',earliest:null,latest:null,maxLen:null},extra?extra(i):{})));return S;};
const setCurves=(S,wd,we)=>{groupsOf(S).forEach(g=>{S.settings.curves[g]={weekday:JSON.parse(JSON.stringify(wd)),weekend:JSON.parse(JSON.stringify(we||wd))};});return S;};
// enkel slumpgenerator för de slumpade konfigurationerna (oberoende av motorns frö)
function rng(seed){let a=seed;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const t2=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function randomConfig(seed){
  const R=rng(seed),ri=(a,b)=>a+Math.floor(R()*(b-a+1)),pick=a=>a[Math.floor(R()*a.length)];
  const nU=ri(1,3),units=[];let g=0;
  for(let u=0;u<nU;u++){const gs=[];for(let k=0,n=ri(1,3);k<n;k++){g++;gs.push({id:'g'+g,name:'G'+g});}units.push({id:'u'+(u+1),name:'Avd '+(u+1),groups:gs});}
  const S=base();S.example=false;S.settings.units=units;
  const d0=ri(24,32)*15,d1=ri(76,88)*15;S.settings.day={start:t2(d0),end:t2(d1)};
  S.settings.shift={min:ri(16,26)*15,max:ri(30,44)*15};
  S.settings.curves={};
  units.forEach(u=>u.groups.forEach(gr=>{const mk=()=>{const pts=[];let t=d0;while(t<d1){pts.push([t2(t),ri(0,5)]);t+=ri(2,16)*15;}return pts;};
    S.settings.curves[gr.id]={weekday:mk(),weekend:mk()};}));
  S.settings.weeks=pick([4,8]);S.settings.rules.lend=pick(['aldrig','behov','fritt']);
  S.staff=[];let n=0;
  units.forEach(u=>u.groups.forEach(gr=>{
    for(let k=0,c=ri(0,14);k<c;k++){n++;
      S.staff.push({id:'r'+n,name:'Person '+n,group:gr.id,pct:pick([100,90,80,75,60,50,25]),wg:pick(['A','B']),
        earliest:R()<.1?t2(ri(24,40)*15):null,latest:R()<.1?t2(ri(60,88)*15):null,maxLen:R()<.08?ri(16,32)*15:null});}}));
  S.locks={};S.staff.forEach(x=>{if(R()<.1){const d=ri(0,S.settings.weeks*7-1),a=d0+ri(0,8)*15;if(d%7<5)S.locks[x.id]={[d]:`${t2(a).replace(':','')}-${t2(a+480).replace(':','')}@${x.group}`};}});
  return S;
}

/* ---------- scenarier ---------- */
const SCEN=[
  // gate: kvalitetsgränser som varje körning måste klara (gäller inte snabbläget, som kör färre iterationer)
  {name:'Standard (demodata, 4 grupper × 14, alla heltid)',make:()=>base(),
    gate:{timmarMiss:0,maxAvvikelseMin:15,luckaVardagH:2,perioder7:1,vikarieHelgH:WEEKEND_GAP,utanforHemgrupp:8,helgSpridning:1,kvallSpridning:20,dagSpridning:4,ledigSpridning:2,mittpassPct:5}},  // appen söker fem gånger längre
  {name:'Blandade tjänstgöringsgrader',make:()=>setAll(base(),(x,i)=>x.pct=[100,100,90,90,85,85,80,80,75,75,75,75,65,50][i%14]),gate:{timmarMiss:1,maxAvvikelseMin:30}},
  {name:'Mest deltid (50–60 %)',make:()=>setAll(base(),(x,i)=>x.pct=i%2?50:60)},
  {name:'Underbemannat: 10 per grupp',make:()=>{const S=base();groupsOf(S).forEach(g=>makeGroup(S,g,Array(10).fill(100)));return S;}},
  {name:'Överbemannat: 18 per grupp',make:()=>{const S=base();groupsOf(S).forEach(g=>makeGroup(S,g,Array(18).fill(100)));return S;},gate:{timmarMiss:1,luckaVardagH:0}},
  // helglagen sparade i obalans fördelas om av systemet, så att helgerna bemannas lika
  {name:'Helglag i obalans jämnas ut (10 udda, 4 jämna)',make:()=>setAll(base(),(x,i)=>x.wg=(i%14)<10?'A':'B'),gate:{luckaVardagH:1,vikarieHelgH:WEEKEND_GAP},
    check:S=>{const bad=[];['g1','g2','g3','g4'].forEach(g=>{const c=[0,1].map(k=>S.staff.filter(x=>x.group===g&&(x.wg==='B'?1:0)===k).length);if(Math.abs(c[0]-c[1])>1)bad.push(`${g}: helglagen ${c[0]} och ${c[1]}`);});return bad;}},
  // en låst ledig lördag i vecka 1 ger laget som arbetar jämna veckor, ett låst helgpass i vecka 2 likaså
  {name:'Låst ledig helgdag styr helglaget',make:()=>{const S=base();S.locks={s1:{'5':'-'},s2:{'12':'0700-1530@g1'}};return S;},
    check:S=>['s1','s2'].filter(id=>S.staff.find(x=>x.id===id).wg!=='B').map(id=>`${id} hamnade inte i laget för jämna veckor`)},
  {name:'Grundschema 8 veckor (timmar per fyraveckorsperiod)',make:()=>{const S=base();S.settings.weeks=8;return S;},gate:{timmarMiss:1,luckaVardagH:6}},  // dubbelt så stort; appen söker fem gånger längre och får 0
  {name:'Kortare heltid: 35 h',make:()=>{const S=base();S.settings.fullTime=35;return S;}},
  {name:'Längre heltid: 40 h',make:()=>{const S=base();S.settings.fullTime=40;return S;}},
  {name:'Ingen utlåning mellan grupper',make:()=>{const S=base();S.settings.rules.lend='aldrig';return S;},gate:{utanforHemgrupp:0}},
  {name:'Fri utlåning mellan grupper',make:()=>{const S=base();S.settings.rules.lend='fritt';return S;}},
  {name:'Bara en avdelning',make:()=>{const S=base();S.settings.units=S.settings.units.slice(0,1);S.staff=S.staff.filter(x=>x.group==='g1'||x.group==='g2');return S;}},
  {name:'En avdelning med tre grupper',make:()=>{const S=base();S.settings.units=[{id:'u1',name:'Avdelningen',groups:[{id:'g1',name:'Norr'},{id:'g2',name:'Söder'},{id:'g3',name:'Väster'}]}];
    S.staff=S.staff.filter(x=>x.group!=='g4');return S;}},
  {name:'Annan arbetsdag 07:00–22:00 med egen kurva',make:()=>{const S=base();S.settings.day={start:'07:00',end:'22:00'};
    return setCurves(S,[['07:00',3],['09:00',4],['11:30',6],['13:30',4],['20:00',3],['21:30',1]],[['07:00',3],['12:00',4],['14:00',3],['21:30',1]]);}},
  {name:'Korta pass (4–8 h)',make:()=>{const S=base();S.settings.shift={min:240,max:480};return S;}},
  {name:'Långa pass (8–11 h)',make:()=>{const S=base();S.settings.shift={min:480,max:660};return S;}},
  {name:'Personliga begränsningar',make:()=>{const S=base();
    S.staff.forEach((x,i)=>{const k=i%14;
      if(k===2)x.latest='16:30';                         // bara dag
      if(k===5){x.latest='15:30';}                       // aldrig kväll
      if(k===7){x.earliest='09:00';}                     // inga tidiga
      if(k===12){x.maxLen=360;x.pct=60;}                 // högst 6 h per pass
      if(k===13){x.earliest='12:00';}});                 // bara kväll
    return S;}},
  {name:'Manuellt lån till annan avdelning',make:()=>{const S=base();S.locks={};
    ['s29','s31','s33','s35','s37'].forEach((id,i)=>S.locks[id]={[String(i*7+2)]:'1300-2130@g1'});
    ['s2','s4'].forEach((id,i)=>S.locks[id]={[String(i*7+1)]:'0645-1500@g3'});return S;}},
  {name:'Många låsningar (2 per person)',make:()=>{const S=base();S.locks={};S.staff.forEach((x,i)=>{const d1=(i*3)%28,d2=(d1+9)%28;const ok=d=>d%7<5;S.locks[x.id]={};
    if(ok(d1))S.locks[x.id][d1]=(i%3===0?'0700-1530@':'0645-1500@')+x.group;if(ok(d2))S.locks[x.id][d2]='-';});return S;}},
  {name:'Låsning som bryter vilan (kväll följt av tidigt)',make:()=>{const S=base();S.locks={s1:{'1':'1300-2130@g1','2':'0645-1500@g1'}};return S;},allowLockedViolations:true,expectFlag:true},
  {name:'Skräpdata och felinmatning',make:()=>{const S=base();S.staff.forEach(x=>x.pct='75%');S.settings.fullTime='37,5';S.settings.day={start:'6.45',end:'2130'};
    S.settings.curves.g1.weekday.push(['25:00',3],['abc',2],['08:00','x']);S.settings.shift={min:'sex',max:20*60};S.settings.units.push({name:'Tom',groups:[]});
    S.staff.push(null,{name:'  ',pct:'abc',group:'finnsinte',earliest:'99',maxLen:'lång'});S.locks={s1:{'3':'zz.9@g1','4':'0645-1500@nope','5':'1500-0700@g1'}};return S;}},
  {name:'Gammal sparad data med passtyper (v7)',make:()=>{const S=base();delete S.settings.curves;delete S.settings.day;delete S.settings.shift;
    S.settings.types=[{id:'t1',name:'Tidig',variants:[['06:45','15:00']]}];S.settings.demand={g1:{weekday:{t1:2}}};S.settings.rules={dailyRest:9,wkEvery:3,night:true};
    S.staff.forEach((x,i)=>{x.wg='ABC'[i%3];x.types=['t1'];});S.locks={s1:{'2':'t1.0@g1'}};S.schedule={s1:{'3':'t1.0@g1'}};return S;}},
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
  ['maxAvvikelseMin','luckaVardagH','perioder7','vikarieHelgH','utanforHemgrupp','helgSpridning','kvallSpridning','dagSpridning','ledigSpridning','mittpassPct'].forEach(k=>{if(g[k]!==undefined&&met[k]>g[k])bad.push(`${k} ${met[k]} (högst ${g[k]})`);});
  return bad;}
const pad=(s,n)=>String(s).padEnd(n).slice(0,n);
console.log(`Schemamotorn · ${SCEN.length} scenarier · frön ${SEEDS.join(', ')} · ${QUICK?'snabbläge':'full körning'}\n`);
for(const sc of SCEN){
  if(ONLY&&!sc.name.toLowerCase().includes(ONLY))continue;
  for(const seed of SEEDS){
    let S,A,ms,errs,met;
    try{S=E.normalize(sc.make());({A,ms}=solve(S,seed));errs=independentChecks(S,A).concat(sc.check?sc.check(S):[]);met=metrics(S,A);}
    catch(e){console.log(`✗ ${sc.name} (frö ${seed}): KRASCH ${e.stack}`);hardFail++;results.push({scenario:sc.name,seed,crash:e.message});continue;}
    const flagged=A.dailyV+A.weeklyV>0;
    let ok=errs.length===0;
    if(sc.allowLockedViolations)ok=errs.every(e=>/dygnsvila|veckovila/.test(e));   // lagbrott som chefen själv låst in räknas inte som motorfel…
    if(sc.expectFlag&&!flagged){ok=false;errs.push('motorn flaggade inte det inlåsta vilobrottet');} // …men måste visas
    if(!ok)hardFail++;
    const gateBad=checkGate(sc.gate,met);if(gateBad.length)gateFail++;
    results.push({scenario:sc.name,seed,ms,ok,gate:gateBad,errors:errs.slice(0,10),...met});
    console.log(`${ok?(gateBad.length?'△':'✓'):'✗'} ${pad(sc.name,52)} ${String(ms).padStart(5)} ms | timmar ${met.timmarOk}/${met.personal} (max ${met.maxAvvikelseMin} min) | lucka vard ${met.luckaVardagH} h helg ${met.vikarieHelgH} h | block ${met.blockPct}% | max ${met.maxDagarIRad} d i rad | helgpass ${met.helgpass} | kväll ${met.kvallsandel} | dagar ±${met.dagSpridning} | utanför hemgrupp ${met.utanforHemgrupp} % | ledig helg ${met.helgVilaH} h | 6-dagarsveckor ${met.sexdagarsveckor} | 6+ i rad ${met.perioder6}, 7+ ${met.perioder7}`);
    (A.todo||[]).filter(i=>i.p<0&&/timmar per vecka/.test(i.text)).forEach(i=>console.log('    → '+i.text));
    errs.slice(0,3).forEach(e=>console.log('    ! '+e));
    gateBad.forEach(e=>console.log('    △ under kvalitetsgränsen: '+e));
  }
}
fs.writeFileSync(OUT,JSON.stringify(results,null,1));
console.log(`\n${hardFail?'✗ '+hardFail+' körningar bröt mot hårda regler':'✓ Inga hårda regler bröts'}${gateFail?` · △ ${gateFail} körningar under kvalitetsgränserna`:QUICK?'':' · alla kvalitetsgränser nåddes'} · resultat i ${path.relative(process.cwd(),OUT)||OUT}`);
process.exit(hardFail||gateFail?1:0);
