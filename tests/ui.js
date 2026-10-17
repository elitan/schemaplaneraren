#!/usr/bin/env node
/* Klicktest för gränssnittet. Startar Chrome utan fönster, öppnar index.html och gör det en användare gör.
   Inga extra paket: Chrome styrs direkt över DevTools-protokollet med Nodes inbyggda WebSocket.
   Kör:  node tests/ui.js        (tar cirka en minut, eftersom första schemat läggs på riktigt)
   Avslutas med felkod 1 om något steg misslyckas eller om sidan skriver fel i konsolen. */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),{spawn}=require('child_process');
const ROOT=path.join(__dirname,'..');
const CHROME=process.env.CHROME||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(f=>fs.existsSync(f));
if(!CHROME){console.error('Hittar inte Chrome. Ange sökvägen med CHROME=...');process.exit(2);}

// liten webbserver för projektmappen
const server=http.createServer((req,res)=>{const f=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'')||'index.html');
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':f.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream'});fs.createReadStream(f).pipe(res);});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,msgId=0;const pending=new Map(),errors=[];
function send(method,params={}){const id=++msgId;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>pending.set(id,{res,rej}));}
async function js(expr){const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw new Error('JS-fel: '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text));return r.result.value;}
async function waitFor(expr,ms,what){const t0=Date.now();while(Date.now()-t0<ms){if(await js(expr))return;await sleep(200);}throw new Error('Väntade för länge på: '+what);}
const idle='!busy&&!!A&&!!S.schedule&&document.getElementById("progress").hidden';

let failed=0;
async function step(name,fn){try{await fn();console.log('✓ '+name);}catch(e){failed++;console.log('✗ '+name+'\n    '+e.message);}}
function expect(cond,msg){if(!cond)throw new Error(msg);}

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port,profile=fs.mkdtempSync(path.join(os.tmpdir(),'schema-ui-'));
  const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1280,900','about:blank'],{stdio:'ignore'});
  // Chrome måste ha stängt innan profilmappen tas bort, annars skriver den fortfarande i den
  const cleanup=async()=>{const gone=new Promise(r=>chrome.once('exit',r));try{chrome.kill();}catch(e){}await Promise.race([gone,sleep(3000)]);
    server.close();try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(e){}};
  try{
    // Chrome skriver sin port i profilmappen
    let dbg=null;for(let i=0;i<100&&!dbg;i++){await sleep(100);try{dbg=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n');}catch(e){}}
    if(!dbg)throw new Error('Chrome startade inte');
    const list=await (await fetch(`http://127.0.0.1:${dbg[0]}/json/list`)).json();
    const page=list.find(t=>t.type==='page');
    ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
    ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(new Error(m.error.message)):p.res(m.result);return;}
      if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?m.params.exceptionDetails.exception.description:m.params.exceptionDetails.text);
      if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));};
    await send('Runtime.enable');await send('Page.enable');
    await send('Page.navigate',{url:`http://127.0.0.1:${port}/index.html`});

    await step('Första gången visas välkomstsidan',async()=>{
      await waitFor('typeof S!=="undefined"',10000,'appen laddas');
      const t=await js('document.getElementById("tab-welcome").hidden?"":document.getElementById("tab-welcome").innerText');
      expect(/Välkommen/.test(t)&&/demodata/.test(t),'välkomstsidan visas inte');});
    await step('Prova med demodata lägger ett första schema',async()=>{
      await js('document.getElementById("wDemo").click()');
      await waitFor(idle,60000,'första schemat');
      const t=await js('document.getElementById("status").innerText');
      expect(/Schemat är klart|behöver åtgärdas/.test(t),'oväntad status: '+t);});
    await step('Schemat visas per grupp',async()=>{
      const r=await js('({g:document.querySelectorAll(".wt .gh").length,c:document.querySelectorAll(".wt .cell.kc").length,G:M.G.length})');
      expect(r.g===r.G&&r.c>50,`grupper ${r.g} av ${r.G}, pass ${r.c}`);});
    await step('Klick på ett pass öppnar dagmenyn, och ett nytt pass sparas och anpassas',async()=>{
      await js('document.querySelector(".wt .cell.kc").click()');
      expect(await js('!document.getElementById("pop").hidden&&document.getElementById("pop").innerText.includes("Grupp")'),'dagmenyn öppnades inte');
      await js('[...document.querySelectorAll("#pop .vbtn[data-act=set]")].find(b=>!b.classList.contains("on")).click()');
      await waitFor(idle,15000,'anpassningen');
      expect(/Ändringen är sparad/.test(await js('document.getElementById("toast").innerText')),'ingen bekräftelse');});
    await step('Ångra återställer ändringen',async()=>{
      await js('document.getElementById("btnUndo").click()');
      expect(/Ångrat/.test(await js('document.getElementById("toast").innerText')),'ångra fungerade inte');});
    await step('Klick på ett namn öppnar personens sida: schemat överst, ändringar i en egen yta under',async()=>{
      await js('document.querySelector(".wt .who").click()');
      const t=await js('document.getElementById("sheet").hidden?"":document.getElementById("sheet").innerText');
      expect(t.includes('Hela perioden')&&t.includes('Begränsningar')&&t.includes('Hemgrupp'),'personens sida saknar innehåll');
      expect(t.indexOf('Hela perioden')<t.indexOf('Ändra uppgifter och begränsningar'),'schemat ska komma före ändringarna');
      expect(await js('!!document.querySelector("#shZone #pf-pct")'),'ändringarna ligger inte i den egna ytan');});
    await step('Klick på bemanningsraden visar dagen för gruppen, och kan visa alla grupper',async()=>{
      await js('document.getElementById("shClose").click();document.querySelector(".covb").click()');
      const t=await js('document.getElementById("sheet").innerText');
      expect(/pass bemannade/.test(t)&&/Lediga i/.test(t),'dagvyn saknar innehåll');
      await js('document.querySelector("[data-dscope=\'-1\']").click()');
      expect(await js('document.querySelectorAll("#sheet .dgroup").length===M.G.length'),'alla grupper visas inte');
      await js('document.querySelector("[data-dstep=\'1\']").click()');
      expect(await js('sheet.kind==="day"&&sheet.d===1'),'bläddring till nästa dag fungerar inte');
      await js('document.querySelector("#sheet .dname").click()');
      expect(await js('sheet.kind==="person"'),'namnet i dagvyn öppnar inte personen');
      await js('document.getElementById("shClose").click()');});
    await step('Klick på en veckodag i tabellhuvudet visar alla grupper',async()=>{
      await js('document.querySelector(".dayh").click()');
      expect(await js('sheet.kind==="day"&&document.querySelectorAll("#sheet .dgroup").length===M.G.length'),'alla grupper visas inte');
      await js('document.getElementById("shClose").click()');
      await js('document.querySelector(".wt .who").click()');});
    await step('Ändrad tjänstgöringsgrad visar Uppdatera schemat, som lägger om',async()=>{
      await js('const s=document.getElementById("pf-pct");s.value=String(+s.value>=60?+s.value-10:+s.value+10);s.dispatchEvent(new Event("change",{bubbles:true}))');
      await waitFor('!!document.getElementById("bnUpdate")',3000,'knappen Uppdatera schemat');
      await js('document.getElementById("shClose").click();document.getElementById("bnUpdate").click()');
      await waitFor(idle,20000,'uppdateringen');
      expect(!(await js('S.stale')),'schemat är fortfarande inaktuellt');});
    await step('Hela perioden visar alla personer',async()=>{
      await js('document.querySelector("#modeSeg [data-mode=period]").click()');
      expect(await js('document.querySelectorAll(".prow").length===M.P'),'fel antal rader');
      await js('document.querySelector("#modeSeg [data-mode=vecka]").click()');});
    await step('Inställningar: lägga till en passtyp och ångra',async()=>{
      await js('document.querySelector("#mainNav [data-tab=regler]").click()');
      const n=await js('S.settings.types.length');
      expect(await js('document.getElementById("tab-regler").innerText.includes("Passtyper och tider")'),'inställningarna visas inte');
      await js('document.getElementById("tadd").click()');
      expect(await js('S.settings.types.length')===n+1,'passtypen lades inte till');
      await js('document.getElementById("btnUndo").click()');
      expect(await js('S.settings.types.length')===n,'ångra tog inte bort passtypen');
      await js('document.querySelector("#mainNav [data-tab=schema]").click()');});
    await step('Klistra in från Excel visar förhandsvisning',async()=>{
      await js('document.querySelector("[data-paste]").click()');
      await js('const t=document.getElementById("pasteArea");t.value="Test Testsson\\t75\\nPer Persson\\t50%";t.dispatchEvent(new Event("input",{bubbles:true}))');
      expect(/2 personer hittades/.test(await js('document.getElementById("pastePrev").innerText')),'förhandsvisningen stämmer inte');
      await js('document.getElementById("shClose").click()');});
    await step('Excel-underlaget har en rad per person',async()=>{
      expect(await js('buildCSV().split("\\r\\n").length===M.P+1'),'fel antal rader');});
    await step('Verksamhetens namn visas i toppfältet',async()=>{
      await js('document.querySelector("#mainNav [data-tab=regler]").click()');
      await js('{const i=document.getElementById("st-org");i.value="Testgården";i.dispatchEvent(new Event("change",{bubbles:true}))}');
      expect(await js('document.getElementById("orgName").textContent==="Testgården"&&document.title.startsWith("Testgården")'),'namnet visas inte');});
    await step('Var tredje helg fördelar personalen på tre helglag',async()=>{
      await js('document.querySelector("[data-every=\'3\']").click()');
      expect(await js('S.settings.rules.wkEvery===3&&S.settings.weeks%3===0&&S.staff.some(x=>x.wg==="C")'),'helglagen fördelades inte');
      expect(await js('document.getElementById("tab-regler").innerText.includes("Var tredje")'),'inställningen visas inte');});
    await step('Nattpass kan slås på och en tid över midnatt sparas',async()=>{
      await js('document.getElementById("st-night").click()');
      await js('{const i=document.querySelector("[data-vt=\'2.0.1\']");i.value="01:00";i.dispatchEvent(new Event("change",{bubbles:true}))}');
      expect(await js('S.settings.rules.night&&S.settings.types[2].variants[0][1]==="01:00"'),'nattiden sparades inte');
      await js('document.getElementById("st-night").click()');
      expect(await js('S.settings.rules.night'),'nattpass gick att stänga av trots en nattid');});
    await step('Radera allt visar välkomstsidan igen',async()=>{
      await js('document.getElementById("rsAll").click()');
      expect(await js('!document.getElementById("tab-regler").hidden'),'raderade utan att fråga');
      await js('document.getElementById("rsAll").click()');
      expect(await js('!document.getElementById("tab-welcome").hidden&&!localStorage.getItem(LS_KEY)'),'allt raderades inte');});
    await step('Guiden lägger upp en ny verksamhet med personal',async()=>{
      await js('document.getElementById("wGuide").click()');
      const set=(sel,v)=>js(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event("input",{bubbles:true}));})()`);
      await set('#gName','Solgården');await set('[data-gu="0"][data-f="name"]','Huset');await set('[data-gu="0"][data-f="groups"]','Norr, Söder');
      await set('#gStaff','Anna Larsson\t100\tNorr\nBo Ek\t75\tSöder\nCia Al\t80%');
      expect(/3 personer: Norr 2, Söder 1/.test(await js('document.getElementById("gStaffInfo").textContent')),'förhandsvisningen stämmer inte');
      await js('document.getElementById("gCreate").click()');
      await waitFor(idle,60000,'schemat för den nya verksamheten');
      expect(await js('M.P===3&&M.G.length===2&&!S.example&&document.getElementById("orgName").textContent==="Solgården"'),'verksamheten lades inte upp');
      expect(await js('!!localStorage.getItem(LS_KEY)'),'verksamheten sparades inte');});
    await step('Inga fel i konsolen',async()=>{expect(!errors.length,errors.slice(0,3).join(' | '));});
  }catch(e){failed++;console.log('✗ '+e.message);}
  finally{await cleanup();}
  console.log(failed?`\n✗ ${failed} steg misslyckades`:'\n✓ Gränssnittet fungerar');
  process.exit(failed?1:0);
})();
