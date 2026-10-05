# KI-Vorprüfung für Belege (Azure OpenAI)

Das Modul **Belege** im Leitendenbereich kann jedes Belegfoto von einem Bildmodell vorprüfen lassen: Ist das ein Beleg, ist er vollständig zu sehen und gut lesbar, also tauglich für das revisionssichere Belegarchiv? Dabei liest das Modell Geschäft, Datum und Betrag und füllt leere Felder der Eingabemaske vor.

- Die Prüfung läuft einmal, sobald ein Foto gewählt wurde (Rückmeldung an die einreichende Person), und noch einmal beim Speichern; dieses Ergebnis wird beim Beleg gespeichert und dem Kassenteam angezeigt.
- Außerdem meldet das Modell Positionen, die in der Jugendarbeit nicht abgerechnet werden dürfen (Alkohol, Tabak, sonstige nicht jugendfreie Artikel). Das ist ein Hinweis für die Kasse und erscheint als „KI: Alkohol/Tabak?“ auf der Karte.
- Die Prüfung ist nur ein Hinweis. Einreichen geht auch mit Mängeln, die Freigabe macht das Kassenteam.
- Ohne Einrichtung (keine App-Settings) wird die Prüfung übersprungen, das Modul funktioniert trotzdem.
- Code: `api/lib/beleg-check.ts`.

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
2. **Bereitstellungen → Modell bereitstellen → Basismodell bereitstellen** → `gpt-4.1-mini` wählen.
3. Einstellungen:
   - **Bereitstellungstyp: Datenzonenstandard** (englisch „Data Zone Standard“) – bei einer Ressource in einer EU-Region werden die Fotos dann nur in der EU verarbeitet. („Globaler Standard“ ist minimal günstiger, verarbeitet aber weltweit.)
   - **Name der Bereitstellung:** `gpt-4.1-mini` (das wird `CONFIG.belege.check.deployment`).
   - **Ratenlimit: Token pro Minute: 5K** (der Regler steht anfangs deutlich höher) – das ist die harte Kostenbremse, siehe unten. Darunter scheitern einzelne Prüfungen, weil ein Foto schon 1.000–3.000 Token braucht.
4. Bereitstellen.

### 4. Endpoint und Schlüssel

In der Azure-OpenAI-Ressource unter **Ressourcenverwaltung → Schlüssel und Endpunkt**:

- **Endpunkt**, z. B. `https://oai-stamm-phoenix.openai.azure.com/` → wird `CONFIG.belege.check.endpoint`
- **Schlüssel 1** → wird `AZURE_OPENAI_API_KEY`

Ohne Schlüssel geht es auch: Dann meldet sich die Website mit ihrer App-Registrierung an. Dafür der App-Registrierung der Website in der Azure-OpenAI-Ressource unter **Zugriffssteuerung (IAM) → Rollenzuweisung hinzufügen** die Rolle **Cognitive Services OpenAI User** geben und `AZURE_OPENAI_API_KEY` leer lassen.

### 5. Konfiguration der Website

In `api/lib/config.ts` unter `belege.check` den Endpunkt (ohne abschließenden `/`), den Namen der Bereitstellung und `maxChecksPerDay` (z. B. `100`) eintragen. Ist `endpoint` oder `deployment` leer, entfällt die Prüfung. Änderungen gelten mit dem nächsten Deployment.

Den Schlüssel im Azure-Portal bei der Static Web App unter **Einstellungen → Umgebungsvariablen** als `AZURE_OPENAI_API_KEY` eintragen, Umgebung **Production** (für Tests auf Previews zusätzlich die Preview-Umgebung). Speichern, die Functions starten danach neu.

### 6. Spalte in der SharePoint-Liste

In der Liste **Belege** eine Spalte **Mehrere Textzeilen** mit dem internen Namen `KiPruefung` anlegen (Nur-Text, kein Rich-Text, kein Anfügen). Dort speichert die Website das Prüfergebnis als JSON. Fehlt die Spalte, funktioniert die Vorprüfung beim Einreichen trotzdem, nur das Kassenteam sieht das Ergebnis dann nicht.

### 7. Testen

Im Leitendenbereich unter **Belege → Beleg einreichen** ein Foto wählen. Nach wenigen Sekunden erscheint „KI-Vorprüfung: …“ und Geschäft, Datum und Betrag sind vorbelegt. Ein absichtlich abgeschnittenes Foto sollte als Mangel gemeldet werden.

## Kosten begrenzen

Azure-Budgets **warnen** nur, sie stoppen nichts. Die Website hat deshalb zwei eigene Bremsen, die stattdessen abbrechen:

1. **Ratenlimit der Bereitstellung (harte Grenze in Azure).** Mit 5.000 Token pro Minute kann das Modell höchstens 5.000 Token pro Minute verbrauchen; alles darüber lehnt Azure mit „429 Too Many Requests“ ab und es entstehen keine Kosten. Selbst im theoretischen Dauerbetrieb rund um die Uhr sind das grob 220 Mio. Token im Monat, bei GPT‑4.1 mini also eine Obergrenze von etwa 90 € – erreichbar nur, wenn jemand die ganze Zeit Fotos hochlädt.
2. **Tageslimit der Website (`CONFIG.belege.check.maxChecksPerDay`).** Ist das Limit erreicht, ruft die Website das Modell an diesem Tag nicht mehr auf; Einreichen geht weiter, nur ohne Vorprüfung. Das Limit zählt pro Functions-Instanz (meist eine, bei Last kurzzeitig mehrere). Bei 100 Prüfungen pro Tag liegen die Kosten unter etwa 0,30 € pro Tag und Instanz. `0` schaltet die Prüfung mit dem nächsten Deployment ab.

Realistisch kostet eine Prüfung etwa 0,1–0,2 Cent (ein Foto ≈ 1.000–3.000 Token Eingabe, die Antwort ≈ 200 Token; Preise laut [Azure-Preisrechner](https://azure.microsoft.com/de-de/pricing/calculator/) prüfen). Jeder Beleg wird zweimal geprüft (Vorschau und Speichern); 100 Belege im Monat kosten also deutlich unter 1 €.

Zusätzlich ein **Budget mit Warnung** einrichten, damit ihr es merkt, falls doch etwas aus dem Ruder läuft:

1. Im Azure-Portal zu **Kostenverwaltung + Abrechnung → Kostenverwaltung → Budgets → Hinzufügen**.
2. Bereich: die Ressourcengruppe `rg-stamm-phoenix-ki`.
3. Name `ki-belege`, Zeitraum **Monatlich**, Betrag z. B. **5 €**.
4. Warnungen: **Tatsächlich** bei 50 % und 100 %, **Prognostiziert** bei 100 %, Empfänger z. B. Kassenteam und Vorstand.

Wenn eine Warnung kommt: sofort die Bereitstellung im Foundry-Portal löschen (Einreichen geht weiter, nur ohne Vorprüfung) und danach per PR `maxChecksPerDay` auf `0` setzen oder `endpoint` leeren.

## Datenschutz

Die Fotos gehen an Azure OpenAI in eurem eigenen Abonnement. Microsoft verwendet sie nicht zum Training. Zur Missbrauchserkennung kann Microsoft Ein- und Ausgaben bis zu 30 Tage speichern; mit „Datenzonenstandard“ in einer EU-Region bleibt die Verarbeitung in der EU. Belege können Namen oder Teile von Kartennummern enthalten – das gehört in das Verzeichnis der Verarbeitungstätigkeiten des Stammes.
