# KI-Vorprüfung für Belege (Azure OpenAI)

Das Modul **Belege** im Leitendenbereich kann jedes Belegfoto von einem Bildmodell vorprüfen lassen: Ist das ein Beleg, ist er vollständig zu sehen und gut lesbar, also tauglich für das revisionssichere Belegarchiv? Dabei liest das Modell Geschäft, Datum und Betrag und füllt leere Felder der Eingabemaske vor.

- Die Prüfung läuft, sobald ein Foto gewählt wurde (Rückmeldung an die einreichende Person, mit Fortschrittsbalken „Beleg wird geprüft …“). Das Ergebnis wird beim Beleg gespeichert und dem Kassenteam angezeigt. Beim Einreichen fragt die API das Modell nicht noch einmal: Sie erkennt dasselbe Foto an seinem Inhalt (SHA-256) und nimmt das Ergebnis der Vorschau oder wartet auf die noch laufende Prüfung (`checkBelegPhoto` in `beleg-check.ts`, je Functions-Instanz, eine Stunde lang). Nur ein anderes oder unbekanntes Foto wird neu geprüft.
- Außerdem meldet das Modell Positionen, die in der Jugendarbeit nicht abgerechnet werden dürfen (Alkohol, Tabak, sonstige nicht jugendfreie Artikel), auch aus abgekürzten Artikelnamen. Das ist ein Hinweis für die Kasse und erscheint als „Evtl. Alkohol/Tabak“ am Beleg.
- Die Prüfung ist nur ein Hinweis. Einreichen geht auch mit Mängeln, die Freigabe macht das Kassenteam.
- Ohne Einrichtung (keine App-Settings) wird die Prüfung übersprungen, das Modul funktioniert trotzdem.
- Code: `api/lib/beleg-check.ts`, der Aufruf von Azure OpenAI in `api/lib/azure-openai.ts`.
- Die Belegprüfung hat eine eigene Bereitstellung (`gpt-6.1-sol-datazone`). Den nächsten Termin und Aufgaben in freigegebenen Protokollen erkennt weiter `gpt-4.1-mini` auf derselben Ressource (siehe [Protokolle](protokolle.md#nächster-termin)).

## Modell

`CONFIG.belege.check` nutzt `gpt-6.1-sol` mit `reasoningEffort: 'medium'` als Bereitstellung im **Datenzonenstandard** auf `website-astro-openai` (Kapazität 100). Die Fotos werden damit nur in der EU verarbeitet.

Ausgewählt im Oktober 2026 nach einem Vergleich mit gezeichneten Belegfotos und bekannter Lösung, je zwei bis drei Läufe mit dem Prompt aus `beleg-check.ts`. Die Fotos enthielten abgekürzten Alkohol und Tabak („RADL.ZITR.“, „OETT.PILS“, „SMIRN.ICE“, „JAEGERM.“, „IQOS TEREA“, „ELFBAR“), Fallen, die nicht gemeldet werden dürfen (alkoholfreies Bier, Kindersekt, Malzbier, Weingummi, Pfand, Essig), einen verblassten Bon, einen abgeschnittenen und einen unscharfen Beleg:

| Modell (Reasoning) | richtig | Ø Zeit | max. Zeit |
| --- | --- | --- | --- |
| `gpt-4.1-mini` (vorher) | 0 von 8 | 3,6 s | 4 s |
| `gpt-5.4` (high) | 15 von 18 | 10,0 s | 27 s |
| `gpt-6-astra` (medium) | 17 von 18 | 6,1 s | 8 s |
| `gpt-6-astra` (high) | 18 von 18 | 8,4 s | 12 s |
| `gpt-6.1-sol` (high) | 18 von 18 | 8,1 s | 12,5 s |

Nachgemessen mit den Regeln für Ränder (siehe unten), knapp zugeschnittenen und abgeschnittenen Belegen und einem echten, 30 Zeilen langen Kassenbon: `gpt-6.1-sol` mit `medium` 16 von 16 richtig in Ø 7,4 s (der echte Bon 18–25 s), mit `high` ebenfalls 16 von 16, aber Ø 12,5 s und bis 41 s. Deshalb `medium`.

`gpt-4.1-mini` übersah Radler und Liquid, meldete alkoholfreies Bier und Malzbier und erkannte die abgeschnittene Summe nicht. Den abgeschnittenen Beleg erkannten nur `gpt-6-astra` und `gpt-6.1-sol` mit `high` in jedem Lauf.

**Vollständig** heißt: Kein Inhalt fehlt (Kopf mit Geschäft, Positionen, Gesamtbetrag, Datum, keine angeschnittenen Zeilen). Papierränder müssen nicht zu sehen sein, weil das Formular Fotos knapp auf den Beleg zuschneidet. Mit dieser Regel (geprüft im Oktober 2026) galten knapp zugeschnittene Belege in allen vier Drehungen als vollständig, ein unten auslaufender Beleg mit allem Text ebenfalls; ein fehlendes Datum und rechts angeschnittene Beträge wurden gemeldet, auch quer fotografiert.

**Drehung zuerst:** Quer liegende Fotos prüft das Modell deutlich langsamer und schlechter (der echte Bon quer: 38–54 s und mit wenig Denkaufwand ohne den Alkohol; aufrecht 11 s). Das Formular fragt deshalb vor der Prüfung nur nach der Drehung (`POST …/pruefung?nur=drehung`, `reasoning_effort: low`, eigenes kurzes Schema): in 3–6 s, in allen Tests richtig, auch für 180°. Es dreht ein neues Foto einmal entsprechend, sofern es seither nicht von Hand gedreht wurde, und prüft dann das aufrechte Foto. Beide Anfragen zählen gegen `maxChecksPerDay`. Die KI erzeugt dabei kein Bild: Drehen, Zuschneiden und Aufhellen rechnet der Browser, damit der Inhalt des Belegs nicht verfälscht werden kann.

Diese Modelle denken vor der Antwort (Reasoning). Sie lehnen `temperature: 0` ab; `azure-openai.ts` sendet deshalb bei gesetztem `reasoningEffort` stattdessen `reasoning_effort`. Die Denk-Token zählen zu `max_completion_tokens` (4.000 für die Belegprüfung), das Timeout liegt bei 60 Sekunden. Für ein anderes Modell: Bereitstellung anlegen, `deployment` und gegebenenfalls `reasoningEffort` in `config.ts` ändern; ohne `reasoningEffort` wird wie früher `temperature: 0` gesendet.

## Einrichtung

Dafür brauchst du Zugriff auf das Azure-Abonnement mit der Nonprofit-Gutschrift und auf die Static Web App der Website.

### 1. Ressourcengruppe

Eine eigene Ressourcengruppe macht die Kosten übersichtlich und lässt sich gezielt mit einem Budget versehen (siehe unten).

1. Im [Azure-Portal](https://portal.azure.com) zu **Ressourcengruppen → Erstellen**.
2. Abonnement: das mit der Nonprofit-Gutschrift. Name z. B. `rg-stamm-phoenix-ki`, Region **Germany West Central**.

### 2. Azure-OpenAI-Ressource

1. **Ressource erstellen** → nach **Azure OpenAI** suchen → **Erstellen**.
2. Ressourcengruppe `rg-stamm-phoenix-ki`, eine EU-Region wie **West Europe** oder **Sweden Central** (die Region bestimmt die Datenzone; zeigt das Portal beim Bereitstellen kein Kontingent, eine andere EU-Region probieren), Name z. B. `oai-stamm-phoenix`, Tarif **Standard S0**.
3. Netzwerk: **Alle Netzwerke** – die Functions der Static Web App haben keine festen IP-Adressen.
4. Erstellen.

### 3. Modell bereitstellen (Deployment)

1. Die neue Ressource öffnen → **Zum Azure AI Foundry-Portal wechseln**.
2. **Bereitstellungen → Modell bereitstellen → Basismodell bereitstellen** → das Modell wählen (für die Belegprüfung `gpt-6.1-sol`, siehe oben).
3. Einstellungen:
   - **Bereitstellungstyp: Datenzonenstandard** (englisch „Data Zone Standard“) – bei einer Ressource in einer EU-Region werden die Fotos dann nur in der EU verarbeitet. („Globaler Standard“ ist minimal günstiger, verarbeitet aber weltweit.)
   - **Name der Bereitstellung:** z. B. `gpt-6.1-sol-datazone` (das wird `CONFIG.belege.check.deployment`).
   - **Ratenlimit:** Es ist die harte Kostenbremse, siehe unten. Unter 5K Token pro Minute scheitern einzelne Prüfungen, weil ein Foto schon 1.000–3.000 Token braucht; ein Reasoning-Modell braucht mehr. Die Bereitstellung `gpt-6.1-sol-datazone` hat die Kapazität 100.
4. Bereitstellen.

### 4. Endpoint und Schlüssel

In der Azure-OpenAI-Ressource unter **Ressourcenverwaltung → Schlüssel und Endpunkt**:

- **Endpunkt**, z. B. `https://oai-stamm-phoenix.openai.azure.com/` → wird `CONFIG.belege.check.endpoint`
- **Schlüssel 1** → wird `AZURE_OPENAI_API_KEY`

Ohne Schlüssel geht es auch: Dann meldet sich die Website mit ihrer App-Registrierung an. Dafür der App-Registrierung der Website in der Azure-OpenAI-Ressource unter **Zugriffssteuerung (IAM) → Rollenzuweisung hinzufügen** die Rolle **Cognitive Services OpenAI User** geben und `AZURE_OPENAI_API_KEY` leer lassen.

### 5. Konfiguration der Website

In `api/lib/config.ts` unter `belege.check` den Endpunkt (ohne abschließenden `/`), den Namen der Bereitstellung und `maxChecksPerDay` (z. B. `100`) eintragen. Ist `endpoint` oder `deployment` leer, entfällt die Prüfung. Änderungen gelten mit dem nächsten Deployment.

Den Schlüssel im Azure-Portal bei der Static Web App unter **Einstellungen → Umgebungsvariablen** als `AZURE_OPENAI_API_KEY` eintragen, Umgebung **Production** (für Tests auf Previews zusätzlich die Preview-Umgebung). Speichern, die Functions starten danach neu.

### 6. Speicherort des Ergebnisses

Die Website speichert das Prüfergebnis als JSON mit dem Beleg in Azure SQL (`organisation.beleg.ai_check`, [azure-sql.md](azure-sql.md)). Dafür ist nichts einzurichten.

### 7. Testen

Im Leitendenbereich unter **Belege → Beleg einreichen** ein Foto wählen. Während der Prüfung zeigt das Formular „Beleg wird geprüft …“ mit einem Fortschrittsbalken; nach etwa zehn Sekunden erscheint das Ergebnis, und Geschäft, Datum und Betrag sind vorbelegt. Ein Foto mit absichtlich abgeschnittenem Betrag oder Datum sollte als Mangel gemeldet werden, ein quer fotografierter Beleg aufrecht gedreht werden.

## Kosten begrenzen

Azure-Budgets **warnen** nur, sie stoppen nichts. Die Website hat deshalb zwei eigene Bremsen, die stattdessen abbrechen:

1. **Ratenlimit der Bereitstellung (harte Grenze in Azure).** Alles über dem Ratenlimit lehnt Azure mit „429 Too Many Requests“ ab, und es entstehen keine Kosten. Für die Belegprüfung ist die Kapazität bewusst großzügig (100), weil Zuverlässigkeit vor Preis geht; die eigentliche Bremse ist das Tageslimit.
2. **Tageslimit der Website (`CONFIG.belege.check.maxChecksPerDay`).** Ist das Limit erreicht, ruft die Website das Modell an diesem Tag nicht mehr auf; Einreichen geht weiter, nur ohne Vorprüfung. Das Limit zählt pro Functions-Instanz (meist eine, bei Last kurzzeitig mehrere). `0` schaltet die Prüfung mit dem nächsten Deployment ab.

Eine Prüfung braucht etwa 1.000–3.000 Token Eingabe für das Foto und einige hundert Token für Denken und Antwort; mit `gpt-6.1-sol` kostet sie deutlich mehr als mit `gpt-4.1-mini`, bei den wenigen Belegen im Monat aber nur Cent- bis niedrige Eurobeträge (Preise laut [Azure-Preisrechner](https://azure.microsoft.com/de-de/pricing/calculator/) prüfen). Ein Beleg wird in der Regel einmal geprüft, beim Einreichen nur dann noch einmal, wenn das Foto ein anderes ist.

Zusätzlich ein **Budget mit Warnung** einrichten, damit ihr es merkt, falls doch etwas aus dem Ruder läuft:

1. Im Azure-Portal zu **Kostenverwaltung + Abrechnung → Kostenverwaltung → Budgets → Hinzufügen**.
2. Bereich: die Ressourcengruppe `rg-stamm-phoenix-ki`.
3. Name `ki-belege`, Zeitraum **Monatlich**, Betrag z. B. **5 €**.
4. Warnungen: **Tatsächlich** bei 50 % und 100 %, **Prognostiziert** bei 100 %, Empfänger z. B. Kassenteam und Vorstand.

Wenn eine Warnung kommt: sofort die Bereitstellung im Foundry-Portal löschen (Einreichen geht weiter, nur ohne Vorprüfung) und danach per PR `maxChecksPerDay` auf `0` setzen oder `endpoint` leeren.

## Datenschutz

Die Fotos gehen an Azure OpenAI in eurem eigenen Abonnement. Microsoft verwendet sie nicht zum Training. Zur Missbrauchserkennung kann Microsoft Ein- und Ausgaben bis zu 30 Tage speichern; mit „Datenzonenstandard“ in einer EU-Region bleibt die Verarbeitung in der EU. Belege können Namen oder Teile von Kartennummern enthalten – das gehört in das Verzeichnis der Verarbeitungstätigkeiten des Stammes.

Die Belegfotos gehen an die Bereitstellung `gpt-6.1-sol-datazone` im Datenzonenstandard und werden damit nur in der EU verarbeitet. Die Bereitstellung `gpt-4.1-mini` für die Protokolle verwendet „Global Standard“; dort kann die Verarbeitung weltweit erfolgen.
