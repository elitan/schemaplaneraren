# Schemaplaneraren

Lägger ett grundschema för vård och omsorg. Schemat följer arbetstidslagen, ger alla exakt sina timmar och samlar ledigheten i sammanhängande block.

**Öppna appen:** https://elitan.github.io/schemaplaneraren/

Appen passar vilken verksamhet som helst. Avdelningar, grupper, passtyper med tider, bemanning, regler och personliga begränsningar ställs in i appen. Inget av verksamheten är inbyggt.

## Data och integritet

- Allt sparas bara i webbläsaren som används (`localStorage`). Inget skickas till någon server, och sidan hämtar inget från andra webbplatser.
- Schemat finns bara i den webbläsaren, på den datorn. Spara en säkerhetskopia till fil under **Inställningar → Säkerhetskopia**, både som backup och för att flytta schemat till en annan dator.
- **Inställningar → Börja om** raderar allt i webbläsaren.

## Kom igång

Första gången visas en välkomstsida med tre val:

1. **Lägg upp er verksamhet.** En kort guide frågar efter:
   - verksamhetens namn
   - avdelningar och deras grupper
   - en mall för passtyperna: tidig, dag, kväll och sen, eller dag, kväll och natt
   - personal, inklistrad från Excel med namn, tjänstgöringsgrad och grupp
2. **Prova med demodata:** två avdelningar med två grupper var och 14 påhittade personer per grupp. Allt går att ändra, och "Lägg upp er verksamhet" i bannern ersätter demodatan.
3. **Öppna säkerhetskopia** från en fil.

## Så används den

Allt sker i en vy, schemat, som visas per grupp.

1. **Personal:** under varje grupp finns "+ Lägg till person" och "Klistra in från Excel".
2. **Klicka på ett namn** för att öppna personens sida.
   - Överst syns timmar, hela perioden, det som är värt att titta på och återhämtning.
   - Under, i en egen yta, ändras namn, tjänstgöringsgrad, hemgrupp, helglag och önskemål.
   - Där sätts också begränsningar: passtyper, tidigast start, senast slut, längsta pass och vilka andra grupper personen kan jobba i.
3. **Klicka på en dag** för att se hur den är bemannad, för en grupp eller för alla.
4. **Klicka på ett pass** för att ändra det.
   - Du kan byta tid, sätta ledigt, markera önskad ledighet eller flytta passet till en annan grupp.
   - Det du ändrar låses, och resten anpassas med så få flyttar som möjligt.
5. **Uppdatera schemat:** när personal eller inställningar ändras visas en knapp. Schemat läggs aldrig om i smyg.
6. **Ladda ner Excel:** en .xlsx med en flik per vecka, en summering och reglerna.
7. **Inställningar** (kugghjulet), se nästa avsnitt.

Ångra finns för allt (knappen i toppen eller Cmd+Z), men bara tills sidan laddas om.

## Inställningar

| Kort | Innehåll |
|---|---|
| Verksamhet | Namn och färg. Namnet visas i toppfältet och i Excel-filen. |
| Grundschema | Längd, heltid och rast. Längden går jämnt upp med helgrytmen. |
| Avdelningar och grupper | Avdelningar med grupper, och om personal får lånas mellan grupper: aldrig, vid behov eller fritt. |
| Passtyper och tider | Namn, färg, kvällspass eller inte och de tider som får användas, högst 12 per typ. |
| Bemanning per grupp | Antal per passtyp, vardag och helg. |
| Vila och nattarbete | Dygnsvila, veckovila och om nattpass är tillåtna. |
| Helger och återhämtning | Helgrytm, prioritering, högst arbetsdagar i rad och per vecka, tyngsta vecka och om helger ska fyllas med ordinarie personal. |
| Säkerhetskopia | Spara till fil och öppna fil. |
| Börja om | Ladda demodata, eller radera allt och börja om. |

Längst ner kan man fälla ut hur varje regel följs.

## Modellen

- **Avdelningar och grupper**
  - Varje person har en hemgrupp.
  - Med utlåning "vid behov" lägger motorn passen i hemgruppen och lånar ut personen till en annan grupp i samma avdelning bara när bemanningen kräver det. "Aldrig" stänger av det, och "fritt" låter motorn lägga personal i alla grupper i avdelningen.
  - Mellan avdelningar flyttar bara chefen, i dagmenyn.
- **Passtyper:** varje typ har de tider som får användas. Motorn väljer bland dem så att alla får exakt sina timmar. Rasten dras på pass längre än 5 timmar, enligt arbetstidslagen.
- **Nattpass:** när nattpass är tillåtna får ett pass gå över midnatt, till exempel 21:30–07:15. Vilan räknas då mot nästa dags pass.
- **Helgrytm:** varannan, var tredje eller var fjärde helg. Personalen delas i lika många helglag, som turas om. Arbetshelg betyder både lördag och söndag.
- **Personliga begränsningar:** passtyper, tidigast start, senast slut, längsta pass och tillåtna grupper. De följs alltid, utom där chefen själv låst ett pass.
- **Grundschemat** upprepas. Längden väljs bland de längder som går jämnt upp med helgrytmen, till exempel 4, 6 eller 8 veckor med varannan helg.

## Arbetstidslagen

| Krav | Standard | Hur det kontrolleras |
|---|---|---|
| Dygnsvila (13 §) | 11 h | Mellan alla pass, även när grundschemat börjar om. |
| Vilan omfattar 00–05 (13 §) | Inga nattpass | Utan nattpass ligger alla pass mellan 05 och 24. Med nattpass visas det i stället som nattarbete. |
| Veckovila (14 §) | 36 h | Inom varje kalendervecka, måndag 00 till söndag 24. |

Gränserna för vila går att sänka, till exempel när ett kollektivavtal tillåter kortare dygnsvila. Appen visar då att valet kräver stöd i avtal. Vilan går före bemanningen: systemet lämnar hellre ett pass tomt än bryter mot den.

## Motorn

Motorn söker ett schema med lägsta möjliga straffpoäng, i tre steg:

1. En snabb första fördelning.
2. Simulerad glödgning med fyra slags sökdrag: byt person, byt passets längd, byt pass mellan två personer samma dag, och byt pass över två dagar.
3. Finslipning av tiderna, så att alla får exakt sina timmar.

Reglerna är namngivna funktioner (`lawDailyRest`, `lawWeeklyRest`, `hours`, `weekends`, `workDays`, `restAroundOff`, `evenWeeks`, `fairness`, `other`). Vikterna ligger i prioritetsnivåer i `W`:

1. **Vila enligt arbetstidslagen.** Ett brott kostar mer än både ett tomt pass och de timmar passet ger. Inför slutfasen gäller full vikt, så inget brott finns kvar i det färdiga schemat.
2. **Bemanning,** tomma vardagspass före tomma helgpass.
3. **Exakta timmar.**
4. **Helgrytmen.**
5. **Återhämtning:** arbetsdagar i rad och per vecka, ledighet i block, vila runt ledigheten och jämna veckor.
6. **Övrigt:** hemgrupp, rättvis fördelning av passtyper och kvällar, och önskemål.

Den verkliga avvägningen är **helger mot långa veckor**. Personalens timmar är fasta, så färre arbetsdagar för heltidare betyder längre pass, och då räcker timmarna till färre helgpass. Avvägningen väljs under "Prioritera": färre vikariepass, balanserat eller färre långa veckor.

"Lägg om schemat" söker i upp till 30 sekunder. Ändringar av enskilda pass tar cirka 2 sekunder. Sökningen körs i webbläsaren i små steg, så att sidan inte fryser.

## Filer

- `index.html`: hela appen, med motorn i `<script id="engine">`.
- `lib/xlsx.full.min.js`: SheetJS 0.18.5 (Apache 2.0) för Excel-filen. Den laddas först när någon laddar ner Excel. Utan den blir det en CSV-fil.
- `tests/`: testsviten för motorn och klicktestet för gränssnittet.
- `.github/workflows/pages.yml`: kör testerna och publicerar appen på GitHub Pages vid varje push till `main`.

## Tester

```
node tests/run.js            # alla scenarier med 2 slumptal, några minuter
node tests/run.js --quick    # snabbkontroll, under en minut
node tests/run.js --only=helg --seeds=6
node tests/ui.js             # klicktest av gränssnittet i Chrome utan fönster, cirka en minut
node tests/sweep.js --only=standard --seeds=4 '{}' '{"wkMiss":1200}'   # jämför vikter
```

`tests/ui.js` letar efter Chrome. Ange en annan Chromium-webbläsare med `CHROME=/sökväg/till/webbläsaren`. Den behöver Node 22 eller senare.

**`tests/run.js`** laddar motorn direkt ur `index.html` och kör scenarier i fem grupper:

- **Demodatan:** standard, alla heltid, mest deltid, under- och överbemanning, obalanserade helglag, preferenser, önskemål, 4 och 8 veckor, 35 och 40 timmars heltid och fyllda helger.
- **Andra strukturer:** en avdelning med tre grupper, en grupp per avdelning, bara en avdelning, en grupp utan personal och en enda person.
- **Egna passtyper och regler:**
  - egna typer och en passtyp med 12 tider
  - var tredje och var fjärde helg
  - nattpass
  - ingen och fri utlåning
  - kortare dygnsvila enligt avtal
  - andra gränser för arbetsdagar
- **Begränsningar och låsningar:** personliga begränsningar, ingen utlåning, manuellt lån till annan avdelning, många låsningar och ett inlåst vilobrott.
- **Robusthet:** skräpdata och sex slumpade konfigurationer.

Hårda regler kontrolleras med en egen, oberoende räkning:

- dygnsvila och veckovila enligt inställningarna
- pass mellan 00 och 05 när nattpass inte är tillåtna
- ledig helg enligt helgrytmen
- låsningar och dubbelbokning
- personliga begränsningar
- att ingen flyttas till en annan grupp eller avdelning utan tillstånd

**Kvalitetsgränser** larmar om en ändring gör schemat sämre. I standardfallet gäller:

- högst en person utan exakta timmar
- inga tomma vardagspass
- högst en period med 7 dagar i rad
- högst 72 helgpass till vikarie
- högst 12 % utanför hemgruppen

Testsviten avslutas med felkod om en hård regel bryts eller en gräns inte nås.

**`tests/ui.js`** startar Chrome utan fönster och gör det en användare gör:

- öppnar välkomstsidan och provar demodata
- ändrar ett pass och ångrar
- öppnar en person och ändrar tjänstgöringsgrad
- uppdaterar schemat
- lägger till en passtyp
- sätter verksamhetens namn, byter helgrytm och slår på nattpass
- raderar allt och lägger upp en ny verksamhet med guiden

Testet larmar vid fel i konsolen. Det behöver inga extra paket.

## Kända begränsningar

- Schemat finns bara i en webbläsare åt gången. Flera chefer som delar ett schema behöver skicka säkerhetskopian mellan sig.
- Med var tredje eller var fjärde helg kan var och en ta färre helgpass, så mer av timmarna behöver rymmas på vardagar. Räcker inte vardagsbemanningen till får en del personal för få timmar, och appen säger det.
- Lokala kollektivavtal kan ha fler regler än de som går att ställa in här.
