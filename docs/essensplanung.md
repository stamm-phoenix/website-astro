# Essensplanung

Neues öffentliches Modul **„Essensplanung“**. Ein Küchenteam plant damit für eine Aktion Mahlzeiten, Gerichte mit Zutaten und die Teilnehmendenzahlen. Daraus berechnet das Modul Einkaufsliste, Einkäufe, Lager und Packliste. Es ersetzt das Google Sheet „2026 – Küche Bezirkslager“ und ist für Leitende des Stammes **und** für Externe gedacht, z. B. Aktionen im Bezirk. Angemeldet wird nicht per OAuth, sondern über **persönliche Links mit Token**.

**Stand: geplant.** Umgesetzt wird in Teil-PRs. Fortschritt, Reihenfolge und Entscheidungen stehen in [#452](https://github.com/stamm-phoenix/website-astro/issues/452); jeder Teil-PR schreibt diese Doku auf den Stand fort, den er umsetzt.

## Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Planung** (Essensplan) | Das Hauptobjekt, zu dem alle Links führen. Hat Name, Tage, Mitglieder. Unabhängig von den Aktionen der Website. Später soll man eine Planung aus einer Aktion heraus anlegen können, mit Name und Tagen vorbelegt. Danach ist sie eigenständig. |
| **Tag** | Ein Tag der Planung mit Datum. Tag 1 ist der erste Tag. |
| **Mahlzeit** | Ein Essens-Slot an einem Tag. Standard: Frühstück, Mittagessen, Kaffee & Kuchen, Abendessen, Mitternachtssnack. Pro Tag frei hinzufügen, umbenennen, löschen und umsortieren. |
| **Mahlzeit-ID** | Angezeigte Bezeichnung `<Tag>_<Slot>`, z. B. `3_1` = erster Slot am dritten Tag. Sie beschreibt **die Position** und wird immer aus der aktuellen Reihenfolge berechnet. Intern hat jede Mahlzeit eine feste UUID, deshalb wandern Einplanungen beim Umsortieren korrekt mit. |
| **Gericht** | Ein Rezept, das zur Planung gehört: Zutaten für eine Referenz-Personenzahl, Werkzeuge, Anleitung, Links. Ein Gericht ist kein Teil einer Mahlzeit. |
| **Einplanung** | Ein Gericht an einer Mahlzeit, mit Faktor und zuständiger Person. Ein Gericht kann an mehreren Mahlzeiten stehen (Standardfrühstück), eine Mahlzeit kann mehrere Gerichte haben (Hauptspeise und Nachtisch). |
| **Zutat** | Eintrag der **zentralen Zutatenliste**. Enthält auch Nicht-Lebensmittel wie Spülmittel. In Gerichten darf nur stehen, was in der Liste steht oder als Abweichung in der Planung angelegt ist. |
| **Teilnehmenden-Zeile** | Eine Anzahl Menschen gleicher Gruppe, Ernährungsform und Unverträglichkeiten, mit Anwesenheit. Es gibt nur Zahlen, keine Personen. |
| **Mitglied** | Jemand mit Zugang zur Planung (eigener Token, Name). Hat nichts mit Mitgliedern des Stammes zu tun. |

## Zugang und Freigabe (ohne OAuth)

- **Links:** Alle Links tragen das Token im Fragment, also `/essensplanung/planung#t=<token>`. Es landet so in keinem Server-Log und in keinem Referrer.
  - Die Seite schickt das Token im Header `x-essensplanung-token`, weil Polling-Requests `GET` sind.
  - Tokens sind 32 Byte aus `randomBytes`, base64url.
  - In der Datenbank steht nur der SHA-256-Hash, verglichen wird in konstanter Zeit. Vorbild ist `hashToken` in `api/lib/nikolaus-bookings.ts`.
- **Persönlicher Link je Mitglied.** Jedes Mitglied hat einen eigenen Link und einen frei wählbaren Anzeigenamen. Diesen Namen sieht man bei Zuständigkeiten und Änderungen.
- **Rollen:**
  - **Besitzer:in**: hat die Planung angelegt.
  - **Bearbeiten**.
  - Die Besitzer:in stellt ein, ob Bearbeitende andere einladen und die Mitglieder verwalten dürfen.
- **Einladen per Mail:** Jede Adresse bekommt einen eigenen Link. Der Zugang lässt sich entziehen, der Link ist danach sofort ungültig.
- **Beitrittslink (optional):** Wer ihn öffnet, gibt einen Namen und optional eine Mailadresse ein und wird Mitglied mit eigenem Link. Er lässt sich zurücksetzen und abschalten.
- **Lese-Link:** zeigt die komplette Planung nur zum Ansehen, z. B. für die Aktionsleitung. Er lässt sich zurücksetzen und abschalten.
- **„Meine Planungen“:**
  - Man gibt eine Mailadresse ein, löst ein ALTCHA und bekommt eine Mail mit Links zu allen Planungen dieser Adresse.
  - Zwischen zwei Anfragen gilt eine Wartezeit. Die Antwort ist immer gleich, auch wenn es die Adresse nicht gibt.
  - Da nur Hashes gespeichert sind, bekommt man dabei **neue** Links. Die alten werden ungültig. Vorbild ist `nikolaus-manage-resend-link.ts`.
  - Zusätzlich merkt sich die Seite im `localStorage`, welche Planungen auf diesem Gerät geöffnet wurden. Das ist nur eine Bequemlichkeit.
- **Anlegen:**
  - Name der Planung, eigener Name und Mailadresse eingeben, ALTCHA lösen.
  - Danach kommt eine Mail mit einem Bestätigungslink. Erst mit dem Klick entsteht die Planung, unbestätigte Anfragen verfallen nach 24 h.
  - Prüfung beim Anlegen:
    - Für Adressen auf `@stamm-phoenix.de` ist das Anlegen immer erlaubt.
    - Für alle anderen nur, wenn „Anlegen durch Externe“ in der Steuerung an ist **und** eine dort gepflegte Whitelist leer ist oder die Adresse beziehungsweise ihre Domain enthält.
- **Leitende** benutzen vorerst ebenfalls nur Links. Eine Übersicht im Leitendenbereich ist eine spätere Ausbaustufe.
- **Routen:**
  - `/essensplanung*` bekommt in `staticwebapp.config.json` `noindex`, `no-store` und `no-referrer`.
  - `/api/essensplanung/*` bekommt `no-store`.
  - **Nicht** unter `/leitendenbereich` oder `/api/intern` legen, und keine `allowedRoles`.

## Steuerung (Leitendenbereich)

Die Seite `/leitendenbereich/essensplanung-steuerung` ist nur für die Teams **`team-admin`** und **`team-vorstand`**.

- **Rolle für Admins:** In `CONFIG.staff.teams` kommt `admin: { groupId: '8d15b638-5de2-4960-a4e4-5e1966cafc55', role: 'team_admin' }` dazu (Gruppe „IT-Administratoren“, Mail-Alias `team-admin`). Die Tabelle in `docs/berechtigungen.md` wird ergänzt.
- **Zugriff:** Die Kachel bekommt `roles: ['team_admin', 'team_vorstand']` in `staffModules.ts`, die API prüft `hasTeam(principal, 'admin') || hasTeam(principal, 'vorstand')`.
  - Wie bei den Kostenstellen bleibt die Seite unter `team_leitende`. Admins ohne Leitenden-Rolle kommen also nicht hinein. So ist es gewollt und so wird es dokumentiert.
- **Inhalt:**
  - **Schalter:** „Anlegen durch Externe“ an/aus, Whitelist (Adressen und Domains), Aufbewahrungszeit (Standard 12 Monate nach dem letzten Tag), Wartungsmodus (Schreiben gesperrt, Lesen geht).
  - **Alle Planungen:** Name, Zeitraum, angelegt am, Besitzer:in (Name und Mail), letzte Änderung, Anzahl Mitglieder. Planungen lassen sich hier löschen.
  - **Zentrale Zutatenliste** pflegen (siehe unten), dazu Kategorien und Unverträglichkeiten.
  - **Vorlagen für neue Planungen:**
    - Gruppen mit Faktor: Wö 0,7, Jupfi 0,8, Pfadi 1,0, Rover 1,2, Leitende 1,2.
    - Standard-Mahlzeiten.
  - **Protokoll** aller Änderungen in der Steuerung mit Person und Zeit, wie `nikolaus.audit_log`.
- **Aufbewahrung:**
  - Ein täglicher Timer (wie in `api/timers/`) löscht Planungen, deren Aufbewahrungszeit abgelaufen ist.
  - 14 Tage vorher bekommen die Besitzer:innen eine Warnmail. Wer etwas ändert, verschiebt die Frist nicht, sie hängt am letzten Tag der Planung.
  - Die Besitzer:in kann die Planung jederzeit selbst löschen.

## Zentrale Zutatenliste

- **Felder:**
  - Name (eindeutig),
  - Kategorie,
  - **Einheitenart**: Masse (g/kg), Volumen (ml/l), Stück, Packung oder Bund,
  - Lebensmittel ja/nein,
  - Abtropfgewicht (Anzeige „kg (ATG)“),
  - Merkmale **vegan**, **vegetarisch** und **Allergene/Unverträglichkeiten**: Gluten, Laktose, Nüsse … nach der zentralen Unverträglichkeiten-Liste,
  - optional die Umrechnungshilfe: Gramm pro TL, Gramm pro EL, Durchschnittsgewicht pro Stück.
- **Wer ändert was:** Gepflegt wird die Liste **nur in der Steuerung**.
  - In einer Planung kann man Zutaten ergänzen oder abweichend festlegen, z. B. eine andere Kategorie oder Einheit. Das gilt **nur für diese Planung**.
  - Abweichungen gezielt in die zentrale Liste zu übernehmen, ist eine spätere Ausbaustufe.
- **Geschäfte** gibt es **nur pro Planung**, niemals zentral. Jede Planung hat ihre eigene Liste (Metro, Bäckerei …), und jede Zutat bekommt in der Planung ein Geschäft.
- **Unverträglichkeiten:** Zentral vorbelegt sind die 14 EU-Hauptallergene, Planungen dürfen eigene ergänzen.
- **Startdaten aus dem Sheet** liegen unter `api/migrations/seed/essensplanung/`, siehe [Startdaten](#startdaten).

## Gerichte

- **Felder:**
  - Name,
  - Referenz-Personenzahl,
  - Anleitung als Freitext (Markdown),
  - Links,
  - Notiz,
  - benötigte **Werkzeuge** als Freitext-Einträge, z. B. „Pürierstab“,
- **Zutatenzeilen:**
  - Zutat (aus der Liste oder eine Abweichung der Planung) und Menge.
  - Einheit passend zur Einheitenart der Zutat (g/kg, ml/l, Stück, Packung, Bund).
  - **Ohne Menge** bei Gewürzen nach Augenmaß („Pfeffer“, „eine Prise“).
  - **Feste Menge**: Die Zeile skaliert nicht mit den Essern und nicht mit dem Faktor der Einplanung, die Menge ist die Gesamtmenge für jede Einplanung des Gerichts. Beispiele aus dem Sheet: 150 g Vanillepaste im Pudding für alle, 10 glutenfreie Müsliriegel im Lunchpaket, und beim Lagercafé („70 L Teig“, 30 kg Mehl) sind alle Zeilen fest. Fest und skalierend lassen sich in einem Gericht mischen.
  - **In der Datenbank wird nie zwischen Einheitenarten umgerechnet.** Milch steht fest in ml/l. Eine Umrechnungshilfe in der Oberfläche schlägt Werte vor, z. B. EL/TL → g aus den Startdaten, für schwierige Fälle per KI.
- **Für wen gilt eine Zeile:**
  - Häkchen **mit allem / vegetarisch / vegan**. Hackfleisch gilt nur für „mit allem“, Soja-Hack für vegetarisch und vegan.
  - Dazu je Unverträglichkeit „nicht für …“.
  - Eine Ersatzzeile kann „nur für …“ sein, z. B. glutenfreie Nudeln nur für Zöliakie.
- **Warnungen**, die die Seite aus den Merkmalen der Zutat ableitet, bevor man die KI fragt:
  - Hackfleisch ist für vegetarisch angehakt.
  - Jemand bekommt an einer Mahlzeit von einem Gericht keine einzige Zeile.
  - Eine Zutat enthält Gluten und ist für Zöliakie nicht ausgenommen.

## Einplanung

- Ein Gericht kommt an eine Mahlzeit, mit Position innerhalb der Mahlzeit.
- **Faktor:** Standard 1, z. B. 0,5, wenn nur die Hälfte Nachtisch isst.
- **Zuständig:** ein Mitglied der Planung oder Freitext.
- Ein Gericht lässt sich zwischen Mahlzeiten verschieben und kopieren.

## Teilnehmende

- **Gruppen der Planung** mit Faktor, aus der Vorlage vorbelegt und frei änderbar.
- **Teilnehmenden-Zeilen:** Gruppe × Ernährungsform (mit allem / vegetarisch / vegan) × Unverträglichkeiten (beliebig viele, auch keine) → Anzahl.
  - Beispiel: „Rover, vegan: 2“, „Wölflinge, vegetarisch: 1“.
  - Dazu die **Anwesenheit pro Mahlzeit**: Standard ist die ganze Planung, sonst von Mahlzeit X bis Mahlzeit Y. Beispiel: „bis 3_4“.
- **Einschränkung pro Mahlzeit:** Welche Gruppen essen mit, z. B. „nur Leitende“ an den Aufbau-Tagen oder „ohne Rover“ ab 6_4.
- **Übersicht:** Esser je Mahlzeit, gewichtet und ungewichtet, nach Ernährungsform. So sieht man es auch im Tagesplan des Sheets.

## Berechnung

Gerechnet wird im Browser aus dem vollständigen Stand der Planung. Das Modul liegt unter `web/src/lib/essensplanung/rechnung.ts` und hat Unit-Tests in `web/test/`, die **gegen Werte aus dem Sheet geprüft** werden.

**Esser** einer Zutatenzeile Z in der Einplanung E an der Mahlzeit M:

> Σ Anzahl × Gruppenfaktor über alle Teilnehmenden-Zeilen, für die gilt:
> - sie sind bei M anwesend, und ihre Gruppe ist bei M zugelassen,
> - ihre Ernährungsform ist bei Z angehakt,
> - keine ihrer Unverträglichkeiten ist bei Z ausgenommen,
> - falls Z „nur für …“ ist: Sie haben eine dieser Unverträglichkeiten.

**Menge:** Z.menge ÷ Referenz-Personenzahl × Esser × E.faktor. Bei einer Zeile mit fester Menge gilt Z.menge, ohne Esser und ohne E.faktor (so rechnet auch das Sheet: dort steht bei „Stufengetränke“ der Gerichtsfaktor auf 0, die festen Mengen zählen trotzdem voll).

**Prüfung am Sheet:**
- Brot 80 g p. P. × 35,5 gewichtete Esser = 2.840 g.
- H-Milch 200 ml × 31,2 (ohne Vegane) = 6.240 ml.

**Summieren und Runden:** Für die Einkaufsliste werden die Mengen je Zutat in der Basiseinheit summiert. Angezeigt wird ab 1.000 g in kg und ab 1.000 ml in l. Stück, Packung und Bund werden erst **nach dem Summieren** aufgerundet. Das Sheet rundet pro Gericht. Wir runden pro Liste, das erzeugt weniger Überschuss.

## Einkaufsliste, Einkäufe, Lager

- **Bedarf:** Summe aller **nicht gekochten und nicht ausgelassenen** Einplanungen, dazu der Zusatzbedarf.
  - **Zusatzbedarf** sind spontan benötigte Dinge oder Dinge, die keinem Gericht gehören, z. B. Spülmittel. Er kommt in den nächsten offenen Einkauf, außer man ordnet ihn fest einem Einkauf zu.
- **Lager:**
  - Zusammensetzung: Anfangsbestand (vor der Aktion vorhanden) + erhalten (abgehakt in Einkäufen) − verbraucht (abgehakte Einplanungen).
  - Was übrig bleibt, weil eine Mahlzeit ausgelassen wurde oder weniger verbraucht als geplant, steht als „übrig“ im Lager.
- **Offene Einkaufsliste:** Bedarf − Lager, nur Positives. Sie wird mit jedem Einkauf kürzer. Vergangene, gekochte Mahlzeiten tauchen darin nicht mehr auf.
- **Einkauf:**
  - Felder: Name, Datum, Geschäft, abgedeckte Mahlzeiten (von–bis).
  - Seine Liste: der offene Bedarf der abgedeckten Mahlzeiten und aller früheren noch nicht gekochten, abzüglich Lager und abzüglich dessen, was frühere offene Einkäufe schon abdecken. Dazu kommt zugeordneter Zusatzbedarf, und nur Zutaten seines Geschäfts.
  - Einzelne Posten lassen sich von Hand in einen anderen Einkauf verschieben oder mit einer festen Menge versehen.
  - Den genauen Algorithmus legt der PR für die Einkäufe mit Tests fest und trägt ihn hier ein.
- **Live-Modus** (handytauglich):
  - Die Liste ist nach Kategorie gruppiert, **ein Häkchen** pro Posten.
  - Beim Abhaken trägt man die **tatsächliche Menge** ein, Standard ist die geplante. Fehlendes bleibt offen und erscheint im nächsten Einkauf wieder.
  - **Ersatzprodukt:** „4 l ~~Coca-Cola~~ → Pepsi Cola“ wird im Lager und im Gericht angezeigt, und für den nächsten Einkauf bleibt „1 l Coca-Cola“ übrig.
  - Läuft mit Netz. Offline ist eine spätere Ausbaustufe.
- **Nach jeder Mahlzeit abhaken:**
  - Jede Einplanung wird als **gekocht** markiert, mit den tatsächlich verbrauchten Mengen je Zutat (Standard: geplant, weniger möglich), oder als **ausgelassen**. Auch einzelne Zutaten lassen sich als nicht verwendet markieren.
  - Ausgelassenes geht nicht vom Lager ab. Danach fällt der Bedarf dieser Einplanung weg.
- **Anfangsbestand:** Wird im Lager eingetragen (Zutat, Menge) und mit der Einkaufsliste verrechnet. Beispiel: Spaghetti im Lager werden nicht neu gekauft.

## Packliste

- Sie entsteht aus den Werkzeugen aller eingeplanten Gerichte. Gleiche Namen werden zusammengefasst, mit den Gerichten und Mahlzeiten, die sie brauchen.
- Man kann eigene Einträge hinzufügen, **Zuständige** zuweisen (Mitglied oder Freitext) und abhaken („gepackt“).

## Gleichzeitiges Bearbeiten

So sicher gegen Konflikte wie der Protokoll-Editor, ohne Neuladen, aber ohne echte Echtzeit:

- **Kleine Änderungen:** Jede Änderung wird einzeln gespeichert (eine Zeile oder ein Feld), nie die ganze Planung. Jede Zeile hat eine `rowversion`. Eine Änderung auf einen veralteten Stand ergibt `409` mit dem aktuellen Stand. Die Oberfläche zeigt den Konflikt an der Stelle und lässt wählen.
- **Änderungszähler:** Jede Schreiboperation erhöht `planung.aenderung_seq` und schreibt einen Eintrag ins Änderungsprotokoll (Entität, ID, Aktion, Mitglied, Zeit). Gelöschtes wird als Tombstone vermerkt.
- **Polling:** Solange der Tab sichtbar ist, fragt die Seite alle 2,5 Sekunden `GET /api/essensplanung/{id}/aenderungen?seit=<seq>` ab und bekommt die geänderten Entitäten.
  - Ohne Änderung kommt nur die `seq` zurück.
  - Ohne Verbindung wartet sie mit wachsendem Abstand bis 30 Sekunden.
- Echte Push-Nachrichten bräuchten Azure Web PubSub, weil die verwaltete API keine WebSockets kann. Das bleibt eine Ausbaustufe.

## KI (Azure OpenAI, `gpt-6.1-sol-datazone`)

- Nutzt die vorhandene Bereitstellung und `api/lib/azure-openai.ts` mit Structured Outputs.
- **Funktionen:**
  - **Gericht prüfen** auf Knopfdruck: Mengen plausibel für die Personenzahl? Tippfehler? Häkchen für Ernährung und Unverträglichkeiten stimmig? Fehlt eine Zutat? Das Ergebnis ist eine Liste von Hinweisen mit Vorschlag.
  - **Rezept aus Freitext:** Aus einem eingefügten Rezept werden Zutatenzeilen. Zuerst wird auf die Zutatenliste abgebildet, Unbekanntes ist markiert. Man bestätigt, bevor etwas übernommen wird.
  - **Umrechnungshilfe** für Fälle ohne Wert in den Startdaten.
- **Kein Kontingent.** Meldet die Bereitstellung `429` oder `503` oder überschreitet sie das Zeitlimit, zeigt die Seite „KI gerade nicht verfügbar, später noch einmal“, gern mit `Retry-After`. Alles andere funktioniert weiter.

## Datenmodell (Schema `essen`, Azure SQL)

Spaltennamen legt der PR fest, der die Tabelle anlegt, und trägt sie hier nach.

| Tabelle | Inhalt |
| --- | --- |
| `einstellungen` | eine Zeile: Anlegen durch Externe, Whitelist, Aufbewahrung, Wartungsmodus |
| `audit_log` | Protokoll der Steuerung |
| `kategorie`, `unvertraeglichkeit`, `zutat`, `zutat_unvertraeglichkeit` | zentrale Listen |
| `vorlage_gruppe`, `vorlage_mahlzeit` | Vorlagen für neue Planungen |
| `anlage_anfrage` | unbestätigte Anlagen (Mail-Bestätigung, 24 h) |
| `planung` | Name, angelegt, Einstellungen (Mitglieder verwalten erlaubt), Hashes von Beitritts- und Lese-Token, `aenderung_seq` |
| `mitglied` | Name, Mail (optional), Rolle, Token-Hash, entzogen |
| `aenderung` | Änderungsprotokoll für Polling und „wer hat was geändert“ |
| `tag`, `mahlzeit`, `mahlzeit_gruppe` | Tage, Slots (Position, Name, Uhrzeit optional), zugelassene Gruppen |
| `gruppe`, `teilnehmende`, `teilnehmende_unvertraeglichkeit` | Teilnehmende mit Anwesenheit von/bis Mahlzeit |
| `geschaeft` | Geschäfte der Planung |
| `planung_zutat` | jede in der Planung genutzte Zutat: Verweis auf die zentrale Zutat (oder keiner bei eigenen), Abweichungen, Geschäft |
| `gericht`, `gericht_zutat`, `gericht_zutat_unvertraeglichkeit`, `gericht_werkzeug` | Rezepte |
| `einplanung`, `einplanung_verbrauch` | Gericht an Mahlzeit, Status offen/gekocht/ausgelassen, tatsächlicher Verbrauch je Zutat |
| `einkauf`, `einkauf_posten` | Einkäufe, verschobene oder feste Posten, erhaltene Menge, Ersatz, abgehakt von/um |
| `zusatzbedarf`, `bestand` | spontane Dinge, Anfangsbestand |
| `packliste_eintrag` | Werkzeuge und eigene Einträge mit Zuständigen und „gepackt“ |

Jede Tabelle mit veränderlichen Zeilen bekommt eine `rowversion`. Löschen einer Planung löscht alles kaskadierend.

## Seiten und Endpunkte

- **Öffentliche Seiten:**
  - `/essensplanung` ist der Einstieg: Planung anlegen, Meine Planungen, Erklärung.
  - `/essensplanung/planung#t=…` (bzw. `#r=…` zum Lesen) ist die App mit den Bereichen:
    - Plan (Tage × Mahlzeiten mit Gerichten),
    - Gerichte, Teilnehmende, Einkaufsliste, Einkäufe (mit Live-Modus), Lager, Packliste,
    - Mitglieder & Freigabe, Einstellungen.
  - Die Texte sind neutral für Externe gehalten („Stamm Phoenix stellt das Werkzeug bereit“).
- **API:** `/api/essensplanung/*` mit Token-Header, `requireEssensplanMitglied(request, planungId, { schreiben })`. Der Lese-Link darf nur `GET`.
- **Steuerung:** `/api/intern/essensplanung-steuerung/*`.
- **Mails:** über `api/lib/mail.ts` mit der Vorlage aus `mail-template.ts`: Bestätigung, Einladung, Meine Planungen, Warnung vor dem Löschen.
- **Datenschutz:** In `web/src/pages/datenschutz.astro` kommt ein Absatz dazu, was gespeichert wird (Name, Mail, Planungsdaten), wofür, wie lange und wie man löscht.

## Startdaten

Aus dem Sheet „2026 – Küche Bezirkslager“ (die Datei selbst liegt nicht im Repo):

- **`api/migrations/seed/essensplanung/`:** zentrale Zutatenliste (392 Lebensmittel, 41 Nicht-Lebensmittel), 28 Kategorien, Vorlagen für Gruppen und Mahlzeiten, Umrechnung TL/EL in Gramm, Stückgewichte und die Metro-Artikel des Lagers mit Packung und Preis. Spalten und Herkunft: [README](../api/migrations/seed/essensplanung/README.md). Die Migration `essen` liest die Dateien; bis dahin sind sie nicht in der Datenbank.
- **`web/test/fixtures/essensplanung-bezirkslager/`:** das ganze Lager (Tagesplan mit Anwesenden je Mahlzeit, 683 Zutatenzeilen mit den Ergebnissen des Sheets, Bestand, Zusätzliches) als Testdaten für die Berechnung. Siehe [README](../web/test/fixtures/essensplanung-bezirkslager/README.md).

## Was wir aus dem Sheet gelernt haben

- **Die Formel stimmt.** Die [Berechnung](#berechnung) oben bildet alle 683 Zutatenzeilen des Sheets exakt nach, inklusive Gerichtsfaktor und fester Gesamtmenge je Zeile.
- **Anwesenheit ändert sich innerhalb eines Tages.** Am Tag 6 reisen die Rover nach dem Mittagessen ab, an Auf- und Abbautagen essen nur Leitende. Deshalb Anwesenheit pro Mahlzeit und eine Einschränkung der Gruppen pro Mahlzeit.
- **Ernährungsformen stehen an der Zutat.** Ein Gericht „Schupfnudeln mit Sauerkraut“ hat „Schupfnudeln“ für mit allem und vegetarisch und „Schupfnudeln (vegan)“ nur für vegan. So bleibt es ein Gericht.
- **Unverträglichkeiten liefen nur als Notiz mit**, z. B. „Allergene: 2x Gluten, 1x Weizen, 13x Laktose“ in der Zutatenspalte. Sie gingen nicht in die Mengen ein. Die Essensplanung macht sie zu Teilnehmenden-Zeilen und Häkchen an der Zutat.
- **Feste Mengen gibt es wirklich, und zwar je Zutatenzeile.** Das Lagercafé („70 L Teig“) braucht 30 kg Mehl, egal wie viele kommen; im Pudding sind nur die 150 g Vanillepaste fest. Feste Zeilen ignorieren den Gerichtsfaktor. Die festen 10 glutenfreien Müsliriegel waren ein Behelf für Zöliakie; dafür gibt es künftig Zeilen „nur für Gluten“.
- **Einheiten:** Im Sheet stehen g, ml, Stück, Packung, Bund und g (ATG). Mehr braucht es nicht.
- **Nicht-Lebensmittel** (Spülmittel, Müllbeutel, Sonnencreme) gehören auf dieselbe Einkaufsliste. Darum stehen sie in der zentralen Liste, mit `lebensmittel = false`.
- **Beim Einkauf wurde zweimal abgehakt** („Im Einkaufswagen“, „Geprüft“). Die erste Version hat ein Häkchen, zwei Stufen sind eine Ausbaustufe.

## Ausbaustufen (später)

- Planung aus einer Aktion der Website anlegen (Name und Tage vorbelegt, später auch Teilnehmendenzahlen).
- „Meine Essensplanungen“ im Leitendenbereich über den Login.
- Abweichungen aus Planungen in die zentrale Zutatenliste übernehmen (Prüfung in der Steuerung).
- Zentrale Sammlung von Gerichten (kopieren statt verknüpfen).
- Packungsgrößen und Aufrunden auf Packungen (Metro-Daten aus dem Sheet).
- Budgetplan mit KI-Unterstützung.
- Zweistufiges Abhaken (im Wagen / geprüft).
- Live-Modus offline mit späterem Abgleich.
- Echte Echtzeit über Azure Web PubSub.

## Entscheidungen

Die vollständige, fortgeschriebene Liste steht in #452.

- Kein OAuth: Links mit Token, Mail nur für Bestätigung, Einladung und Wiederfinden.
- Anwesenheit pro Mahlzeit, mit Einschränkung der Gruppen pro Mahlzeit (wie im Sheet).
- Geschäfte nur pro Planung, nie zentral.
- Keine Umrechnung zwischen Einheitenarten in der Datenbank.
- Unverträglichkeiten pro Zutatenzeile (ausgenommen / nur für), nicht über eigene Gerichte. Mehrere Gerichte pro Mahlzeit sind für Haupt- und Nachspeise gedacht.
- Aufrunden von Stück, Packung und Bund nach dem Summieren.
- Wer eine `@stamm-phoenix.de`-Adresse hat, darf immer anlegen; Schalter und Whitelist gelten für alle anderen.
- „Meine Planungen“ verschickt neue Links, die alten werden ungültig (nur Hashes gespeichert).
- Die Steuerung erreichen nur Admins/Vorstände, die auch die Rolle `team_leitende` haben.
- Aufbewahrung hängt am letzten Tag der Planung, Warnmail 14 Tage vorher.
- Jede Ansicht ist druckbar (`@media print`).
