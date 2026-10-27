# Schemaplaneraren

Lägger ett grundschema för vård och omsorg. Du anger hur många som ska arbeta vid olika tider på dagen, och motorn lägger passen. Schemat följer arbetstidslagen, ger alla exakt sina timmar för varje fyraveckorsperiod och samlar ledigheten i sammanhängande block.

**Öppna appen:** https://elitan.github.io/schemaplaneraren/

Appen passar vilken verksamhet som helst. Avdelningar, grupper, arbetsdag, bemanningskurvor, regler och personliga begränsningar ställs in i appen. Inget av verksamheten är inbyggt.

## Data och integritet

- Allt sparas bara i webbläsaren som används (`localStorage`). Inget skickas till någon server, och sidan hämtar inget från andra webbplatser.
- Schemat finns bara i den webbläsaren, på den datorn. Spara en säkerhetskopia till fil under **Inställningar → Säkerhetskopia**, både som backup och för att flytta schemat till en annan dator.
- **Inställningar → Börja om** raderar allt i webbläsaren.

## Kom igång

Första gången visas en välkomstsida med tre val:

1. **Lägg upp er verksamhet.** En kort guide frågar efter:
   - verksamhetens namn
   - avdelningar och deras grupper
   - personal, inklistrad från Excel med namn, tjänstgöringsgrad och grupp
2. **Prova med demodata:** två avdelningar, omvårdnad och demens, med två grupper var och 14 påhittade personer per grupp, alla på heltid. Allt går att ändra, och "Lägg upp er verksamhet" i bannern ersätter demodatan.
3. **Öppna säkerhetskopia** från en fil.

## Så används den

Allt sker i en vy, schemat, som visas per grupp.

1. **Personal:** under varje grupp finns "+ Lägg till person" och "Klistra in från Excel".
2. **Klicka på ett namn** för att öppna personens sida.
   - Överst syns timmar, hela perioden, det som är värt att titta på och återhämtning.
   - Under, i en egen yta, ändras namn, tjänstgöringsgrad och hemgrupp. Helglag och kvällar fördelas av systemet, se Modellen.
   - Där sätts också begränsningar: tidigast start, senast slut och längsta pass. Tomt betyder ingen begränsning.
3. **Klicka på en dag** för att se hur den är bemannad, för en grupp eller för alla. Ett diagram visar kurvan och hur många som arbetar, och var det saknas folk.
4. **Klicka på ett pass** för att ändra det.
   - Du kan välja start och slut, sätta ledigt eller flytta passet till en annan grupp.
   - Det du ändrar låses, och resten anpassas med så få flyttar som möjligt.
5. **Uppdatera schemat:** när personal eller inställningar ändras visas en knapp. Schemat läggs aldrig om i smyg.
6. **Ladda ner Excel:** en .xlsx med en flik per vecka, en summering och reglerna.
7. **Inställningar**, se nästa avsnitt.

Ångra finns för allt (knappen i toppen eller Cmd+Z), men bara tills sidan laddas om.

## Inställningar

| Kort | Innehåll |
|---|---|
| Bemanning | En kurva per grupp för vardag och helg. Varje rad säger "från klockan, minst så många personer" och gäller till nästa rad. Kurvan visas som ett diagram. Den kan kopieras mellan vardag och helg och till alla grupper i avdelningen. |
| Arbetsdag och pass | När arbetsdagen börjar och slutar, till exempel 06:45–21:30, och kortaste och längsta pass. |
| Verksamhet | Namn och färg. Namnet visas i toppfältet och i Excel-filen. |
| Grundschema | 4 eller 8 veckor, och heltid i timmar per vecka. |
| Avdelningar och grupper | Avdelningar med grupper, och om personal får lånas mellan grupper: aldrig, vid behov eller fritt. |
| Arbetsdagar och vila | Högst arbetsdagar i rad och per vecka. Vilan följer lagen och går inte att ändra. |
| Säkerhetskopia | Spara till fil och öppna fil. |
| Börja om | Ladda demodata, eller radera allt och börja om. |

Längst ner kan man fälla ut hur varje regel följs.

## Modellen

- **Bemanningskurva i stället för passtyper.** Det spelar ingen roll om den som arbetar kl. 12 har ett tidigt eller sent pass, bara att de är tillräckligt många. Motorn väljer varje pass start och slut inom arbetsdagen, på hela och halva timmar och kurvans egna tider, med längd mellan kortaste och längsta pass. Personal utöver kurvan läggs helst på dagen, före 15.
- **Timmar:** exakt för varje fyraveckorsperiod. Heltid 37 h i veckan blir 148 h på fyra veckor. Med 8 veckors grundschema stämmer båda perioderna var för sig.
- **Rast:** pass över 5 timmar har 30 minuter och pass över 10 timmar en timme. Rasten räknas inte som arbetstid.
- **Avdelningar och grupper**
  - Varje person har en hemgrupp, och kurvan gäller per grupp.
  - Med utlåning "vid behov" lägger motorn passen i hemgruppen och lånar ut personen till en annan grupp i samma avdelning bara när bemanningen kräver det. "Aldrig" stänger av det, och "fritt" låter motorn lägga personal i alla grupper i avdelningen.
  - Mellan avdelningar flyttar bara chefen, i dagmenyn.
- **Helger:** alla arbetar varannan helg, udda eller jämna veckor, och båda dagarna. Systemet delar varje grupp i två lika stora helglag, så att alla arbetar lika många helger och helgerna bemannas lika. Den som har en låst ledig lördag eller söndag hamnar i laget som är ledigt den helgen.
- **Kvällar:** ett pass som slutar efter 19 är ett kvällspass. Alla får lika stor andel kvällar som snittet i avdelningen. Det finns inga önskemål om dag eller kväll, eftersom de gör fördelningen ojämn och schemat svårare att lägga.
- **Personliga begränsningar:** tidigast start, senast slut och längsta pass, för den som till exempel inte kan jobba kväll. De följs alltid, utom där chefen själv låst ett pass.
- **Rättvisa:** personens sida och Excel-filen visar antal pass, kvällar och helgpass, och under Inställningar visas spannet för alla.
- **Grundschemat** upprepas.

## Arbetstidslagen

| Krav | Värde | Hur det kontrolleras |
|---|---|---|
| Dygnsvila (13 §) | 11 h | Mellan alla pass, även när grundschemat börjar om. |
| Vilan omfattar 00–05 (13 §) | Inga nattpass | Arbetsdagen ligger mellan 05 och 24. |
| Veckovila (14 §) | 36 h | Inom varje kalendervecka, måndag 00 till söndag 24. |
| Rast (15 §) | Efter högst 5 h | 30 minuter på pass över 5 timmar, en timme över 10 timmar. |

Vilan går inte att ändra. Den går före bemanningen: systemet lämnar hellre en lucka i kurvan än bryter mot den.

## Motorn

Motorn söker ett schema med lägsta möjliga straffpoäng, i tre steg:

1. En snabb första fördelning.
2. Simulerad glödgning med sökdrag som flyttar passets start eller slut, lägger till eller tar bort ett pass, flyttar ett pass till en annan dag, ger ett pass till en kollega (och tar ett av kollegans pass en annan dag), byter pass med en kollega samma dag och lånar ut till en annan grupp. Varje drag räknar bara om de personer och dagar det berör.
3. Finslipning av start- och sluttider, så att alla får exakt sina timmar.

Reglerna är namngivna funktioner (`lawDailyRest`, `lawWeeklyRest`, `hours`, `weekends`, `workDays`, `restAroundOff`, `evenWeeks`, `fairness`, `other`). Vikterna ligger i prioritetsnivåer i `W`:

1. **Vila enligt arbetstidslagen.** Ett brott kostar mer än både ett tomt pass och de timmar passet ger. Inför slutfasen gäller full vikt, så inget brott finns kvar i det färdiga schemat.
2. **Bemanningskurvan,** per person och timme som saknas. Luckor på vardagar väger tyngre än på helger, som går till vikarie. Personal utöver kurvan kostar lite och mer efter 15.
3. **Exakta timmar.**
4. **Helgrytmen.**
5. **Återhämtning:** arbetsdagar i rad och per vecka, ledighet i block, vila runt ledigheten och jämna veckor.
6. **Rättvisa och övrigt:** lika andel kvällar för alla (målet följer avdelningens faktiska snitt under sökningen), och hemgruppen.

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
node tests/sweep.js --only=standard --seeds=4 '{}' '{"away":120}'   # jämför vikter
```

`tests/ui.js` letar efter Chrome. Ange en annan Chromium-webbläsare med `CHROME=/sökväg/till/webbläsaren`. Den behöver Node 22 eller senare.

**`tests/run.js`** laddar motorn direkt ur `index.html` och kör scenarier i fem grupper:

- **Demodatan:** standard, blandade tjänstgöringsgrader, mest deltid, under- och överbemanning, helglag i obalans som jämnas ut, låst ledig helgdag som styr helglaget, 8 veckor och 35 och 40 timmars heltid.
- **Andra strukturer:** en avdelning med tre grupper, bara en avdelning, en grupp utan personal och en enda person.
- **Egen arbetsdag och regler:** annan arbetsdag med egen kurva, korta och långa pass, ingen och fri utlåning, och andra gränser för arbetsdagar.
- **Begränsningar och låsningar:** personliga begränsningar, manuellt lån till annan avdelning, många låsningar och ett inlåst vilobrott.
- **Robusthet:** skräpdata, gammal sparad data med passtyper och sex slumpade konfigurationer.

Hårda regler kontrolleras med en egen, oberoende räkning:

- dygnsvila 11 h och veckovila 36 h
- pass utanför arbetsdagen eller med fel längd
- bemanningen, räknad kvart för kvart och jämförd med motorns siffra
- ledig helg enligt helgrytmen
- låsningar och dubbelbokning
- personliga begränsningar
- att ingen flyttas till en annan grupp eller avdelning utan tillstånd

**Kvalitetsgränser** larmar om en ändring gör schemat sämre. I standardfallet gäller:

- alla får exakta timmar
- högst två timmars lucka i kurvan på vardagar (appen söker fem gånger längre än testet och brukar inte ha någon)
- alla har lika många helgpass, högst ett skiljer
- kvällsandelen skiljer högst 20 procentenheter mellan personer
- ingen period med 7 dagar i rad
- högst 12 helgtimmar till vikarie
- högst 8 % utanför hemgruppen

Testsviten avslutas med felkod om en hård regel bryts eller en gräns inte nås.

**`tests/ui.js`** startar Chrome utan fönster och gör det en användare gör:

- öppnar välkomstsidan och provar demodata
- ändrar ett pass och ångrar
- öppnar en person och ändrar tjänstgöringsgrad
- uppdaterar schemat
- öppnar dagvyn med diagrammet
- lägger till en tid i bemanningskurvan, ångrar och byter till helgkurvan
- sätter verksamhetens namn och ändrar arbetsdag och passlängd
- raderar allt och lägger upp en ny verksamhet med guiden

Testet larmar vid fel i konsolen. Det behöver inga extra paket.

## Kända begränsningar

- Schemat finns bara i en webbläsare åt gången. Flera chefer som delar ett schema behöver skicka säkerhetskopian mellan sig.
- Räcker inte personalens timmar till kurvan blir det luckor, och appen säger var. Har personalen fler timmar än kurvan kräver läggs de extra på dagen.
- Sparad data från versionen med passtyper behåller personal och grupper, men schemat och låsningarna läggs om, och kurvan börjar som standardkurvan.
- Lokala kollektivavtal kan ha fler regler än de som går att ställa in här.
