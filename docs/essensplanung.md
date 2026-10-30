# Essensplanung

Neues öffentliches Modul **„Essensplanung“**. Ein Küchenteam plant damit für eine Aktion Mahlzeiten, Gerichte mit Zutaten und die Teilnehmendenzahlen. Daraus berechnet das Modul Einkaufsliste, Einkäufe, Lager und Packliste. Es ersetzt das Google Sheet „2026 – Küche Bezirkslager“ und ist für Leitende des Stammes **und** für Externe gedacht, z. B. Aktionen im Bezirk. Angemeldet wird nicht per OAuth, sondern über **persönliche Links mit Token**.

**Stand: Steuerung und zentrale Listen (PR 2) sowie Planungen mit Tagen, Mahlzeiten, Mitgliedern und Links (PR 3) sind umgesetzt; Gerichte und alles Weitere folgen.** Umgesetzt wird in Teil-PRs. Fortschritt, Reihenfolge und Entscheidungen stehen in [#452](https://github.com/stamm-phoenix/website-astro/issues/452); jeder Teil-PR schreibt diese Doku auf den Stand fort, den er umsetzt.

## Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Planung** (Essensplan) | Das Hauptobjekt, zu dem alle Links führen. Hat Name, Tage, Mitglieder. Unabhängig von den Aktionen der Website. Später soll man eine Planung aus einer Aktion heraus anlegen können, mit Name und Tagen vorbelegt. Danach ist sie eigenständig. |
| **Tag** | Ein Tag der Planung mit Datum. Tag 1 ist der erste Tag. |
| **Mahlzeit** | Ein Essens-Slot an einem Tag. Standard: Frühstück, Mittagessen, Kaffee & Kuchen, Abendessen, Mitternachtssnack. Pro Tag frei hinzufügen, umbenennen, löschen und umsortieren. |
| **Mahlzeit-ID** | Angezeigte Bezeichnung `<Tag>_<Slot>`, z. B. `3_1` = erster Slot am dritten Tag. Sie beschreibt **die Position** und wird immer aus der aktuellen Reihenfolge berechnet. Intern hat jede Mahlzeit eine feste UUID, deshalb wandern Einplanungen beim Umsortieren korrekt mit. |
| **Gericht-ID** | `<Tag>_<Slot>_<Gericht>`, z. B. `3_2_2` = zweites Gericht beim zweiten Slot am dritten Tag. Wie die Mahlzeit-ID aus der aktuellen Reihenfolge berechnet. |
| **Gericht** | Ein Rezept, das zur Planung gehört: Zutaten für eine Referenz-Personenzahl, Werkzeuge, Anleitung, Links. Ein Gericht ist kein Teil einer Mahlzeit. |
| **Einplanung** | Ein Gericht an einer Mahlzeit, mit Faktor und zuständiger Person. Ein Gericht kann an mehreren Mahlzeiten stehen (Standardfrühstück), eine Mahlzeit kann mehrere Gerichte haben (Hauptspeise und Nachtisch). |
| **Zutat** | Eintrag der **zentralen Zutatenliste**. Enthält auch Nicht-Lebensmittel wie Spülmittel. In Gerichten darf nur stehen, was in der Liste steht oder als Abweichung in der Planung angelegt ist. |
| **Teilnehmenden-Zeile** | Eine Anzahl Menschen gleicher Gruppe, Ernährungsform und Unverträglichkeiten, mit Anwesenheit. Es gibt nur Zahlen, keine Personen. |
| **Mitglied** | Jemand mit Zugang zur Planung (eigener Token, Name). Hat nichts mit Mitgliedern des Stammes zu tun. |

## Zugang und Freigabe (ohne OAuth)

- **Links:** Alle Links tragen das Token im Fragment, also `/essensplanung/planung#t=<token>`. Es landet so in keinem Server-Log und in keinem Referrer.
  - Die Seite schickt das Token im Header `x-essensplanung-token`, weil Polling-Requests `GET` sind.
  - Tokens sind 32 Byte aus `randomBytes`, base64url.
  - In der Datenbank steht für persönliche Links nur der SHA-256-Hash. Vorbild ist `hashToken` in `api/lib/nikolaus-bookings.ts`.
  - Die gemeinsamen Links (Beitritt, Lesen) stehen im Klartext in `essen.planung` (wie `link_token` der Abstimmungen), weil Mitglieder sie jederzeit wieder ansehen und kopieren können sollen. Sie lassen sich neu erzeugen und abschalten.
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
  - Danach kommt eine Mail mit einem Bestätigungslink. Erst mit dem Klick entsteht die Planung, unbestätigte Anfragen verfallen nach 24 h und werden nach sieben Tagen gelöscht. Je Adresse gehen höchstens drei Anfragen pro Stunde.
  - Prüfung beim Anlegen:
    - Für Adressen auf `@stamm-phoenix.de` ist das Anlegen immer erlaubt.
    - Für alle anderen nur, wenn „Anlegen durch Externe“ in der Steuerung an ist **und** eine dort gepflegte Whitelist leer ist oder die Adresse beziehungsweise ihre Domain enthält.
- **Leitende** benutzen vorerst ebenfalls nur Links. Eine Übersicht im Leitendenbereich ist eine spätere Ausbaustufe.
- **Routen:**
  - `/essensplanung*` bekommt in `staticwebapp.config.json` `noindex`, `no-store` und `no-referrer`.
  - `/api/essensplanung/*` bekommt `no-store`.
  - **Nicht** unter `/leitendenbereich` oder `/api/intern` legen, und keine `allowedRoles`.

## Steuerung (Leitendenbereich)

Die Seite `/leitendenbereich/essensplanung-steuerung` (Kachel „Essensplanung“ unter „Gruppen & Aktionen“) ist nur für die Teams **`team-admin`** und **`team-vorstand`**.

- **Rollen:** `CONFIG.staff.teams.admin` ist die Gruppe „IT-Administratoren“ (Mail-Alias `team-admin`, Rolle `team_admin`), siehe [Berechtigungen](berechtigungen.md). Die Kachel hat `roles: ['team_admin', 'team_vorstand']`, die API prüft `hasTeam(principal, 'admin') || hasTeam(principal, 'vorstand')` (`api/endpoints/intern-essensplanung-steuerung.ts`).
  - Wie bei den Kostenstellen bleibt die Seite unter `team_leitende`. Admins ohne Leitenden-Rolle kommen also nicht hinein.
- **Einstellungen** (eine Zeile `essen.einstellungen`, gespeichert mit Version wie die Nikolaus-Steuerung):
  - **Anlegen durch Externe** an/aus und die **Liste erlaubter Adressen und Domains**. Die Regel steht in `darfPlanungAnlegen` (`api/lib/essen-validation.ts`): `@stamm-phoenix.de` darf immer; alle anderen nur bei eingeschaltetem Schalter und wenn die Liste leer ist oder die Adresse oder genau ihre Domain enthält (Subdomains zählen nicht).
  - **Aufbewahrung** in Monaten nach dem letzten Tag (1 bis 120, Standard 12).
  - **Wartungsmodus**: Änderungen an Planungen werden abgelehnt (`503`), Lesen geht.
  - **Vorlagen für neue Planungen**: Gruppen mit Faktor (Wö 0,7, Jupfi 0,8, Pfadi 1, Rover 1,2, Leitende 1,2) und die Mahlzeiten eines neuen Tages. Sie stehen als JSON in `essen.einstellungen`, weil eine neue Planung sie nur kopiert.
- **Zentrale Zutatenliste, Kategorien, Allergene** pflegen (siehe unten). Kategorien lassen sich erst löschen, wenn keine Zutat mehr dazugehört; die 14 EU-Hauptallergene nur umbenennen.
- **Protokoll**: Jede Änderung steht mit Person und Zeit in `essen.audit_log`; die Seite zeigt die letzten 100.
- **Alle Planungen**: Name, Besitzer:innen, Zeitraum und Löschdatum, mit Löschen (Audit-Eintrag). Den Inhalt sieht die Steuerung nicht.
- **Aufbewahrung**: Der Timer `essensplanungAufbewahrung` (`api/timers/essensplanung-aufbewahrung.ts`, täglich 03:23 UTC, in der Function App der Timer, siehe [Aufgaben-Timer](aufgaben-timer.md)) ruft `raeumeAuf` (`api/lib/essen-aufbewahrung.ts`). Er löscht alte Anfragen, schickt den Besitzer:innen 14 Tage vor dem Löschdatum eine Warnmail (je Besitzer:in einmal pro Löschdatum, `mitglied.loeschwarnung_fuer`; eine gescheiterte Mail wird am nächsten Tag nachgeholt) und löscht abgelaufene Planungen. Vor dem Löschen sperrt er die Planung und rechnet das Datum neu, eine inzwischen verlängerte Planung bleibt. Die Frist hängt am letzten Tag der Planung, Änderungen verschieben sie nicht; die Besitzer:in kann jederzeit selbst löschen. Not-Aus `ESSENSPLANUNG_AUFBEWAHRUNG_ENABLED` (Standard `false`).

### API

| Methode und Route | Inhalt |
| --- | --- |
| `GET /api/intern/essensplanung/steuerung` | Einstellungen mit `etag`, Kategorien, Unverträglichkeiten, Zutaten, Protokoll |
| `PUT /api/intern/pflege/essensplanung/einstellungen` | `{ etag, einstellungen }`; `409` bei veralteter Version |
| `POST /api/intern/pflege/essensplanung/{zutaten\|kategorien\|unvertraeglichkeiten}` | neuer Eintrag; Antwort `{ id, view }` |
| `PATCH /api/intern/pflege/essensplanung/{liste}/{id}` | `{ etag, … }` ändert; `409` bei veralteter Version |
| `DELETE /api/intern/pflege/essensplanung/{liste}/{id}` | mit `If-Match`; `400` bei benutzten Kategorien und EU-Allergenen |

Alle schreibenden Routen antworten mit der ganzen Ansicht wie `GET`, die Seite ersetzt damit ihren Stand. Doppelte Namen ergeben `400` mit `fields.name`. Prüfungen ohne Datenbank (auch für die Mock-API) stehen in `api/lib/essen-validation.ts`, Lesen und Schreiben in `api/lib/essen-steuerung.ts`.

## Zentrale Zutatenliste

- **Felder:**
  - Name (eindeutig),
  - Kategorie,
  - **Einheitenart**: Masse (g/kg), Volumen (ml/l), Stück, Packung oder Bund,
  - Lebensmittel ja/nein,
  - Abtropfgewicht (Anzeige „kg (ATG)“),
  - Merkmale **vegan**, **vegetarisch** und **Allergene/Unverträglichkeiten**: Gluten, Laktose, Nüsse … nach der zentralen Unverträglichkeiten-Liste,
  - optional die Umrechnungshilfe: Gramm pro TL, Gramm pro EL, Durchschnittsgewicht pro Stück.
- **Merkmale aus den Startdaten** (vegetarisch, vegan, Allergene) sind ungeprüfte Vorschläge (`merkmale_geprueft = 0`). Die Steuerung zeigt „Merkmale ungeprüft“ und filtert mit „Nur ungeprüfte“; wer einen Eintrag prüft, hakt „Ernährung und Allergene sind geprüft“ an. Vegetarisch/vegan sind `NULL`, solange unbekannt; vegan schließt vegetarisch ein (Datenbankregel). Nicht-Lebensmittel haben weder Ernährung noch Allergene.
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
  - **Bearbeiten wie in einer Tabelle:** Menge, Einheit und Hinweis stehen beim Bearbeiten als Felder in der Zeile (`ZutatZeileInline.svelte`) und werden gespeichert, wenn der Fokus die Zeile verlässt oder Enter gedrückt wird; Escape setzt die Zeile zurück. Hat jemand anderes die Zeile inzwischen geändert, bleibt die Eingabe stehen und die Zeile nennt den neuen Stand. Entfernt jemand anderes die Zeile oder das Gericht, nennt die Seite die ungespeicherte Eingabe zum Abschreiben (`meldeVerloren` in `planKontext.ts`). „Ändern“ speichert getippte Werte der Zeile zuerst, damit der Dialog mit ihnen beginnt; gespeichert wird immer mit der Version, die beim Prüfen galt, auch wenn die Änderung in der Warteschlange wartet. Speicherläufe einer Zeile laufen nacheinander; was während eines Laufs weitergetippt wird, bleibt stehen und wird danach gespeichert. Die neue Zeile hält ihre Eingabe in der Gerichtskarte, sodass sie eine Phase ohne Bearbeiten (Wartungsmodus) übersteht; ihre Einheit folgt der Zutat nur, solange keine Menge getippt ist. Unter dem Gericht steht eine leere Zeile (`NeueZutatZeile.svelte`) für eine Zutat aus der Liste mit Menge, Einheit und Hinweis (für alle, nicht fest); Enter fügt sie hinzu und setzt den Fokus wieder auf den Namen. Alles andere (für wen, Unverträglichkeiten, feste Menge, eigene Zutaten) steht im Dialog hinter „Ändern“ bzw. „Mehr Angaben …“, der übernimmt, was schon getippt ist.
  - Zutat (aus der Liste oder eine Abweichung der Planung) und Menge.
  - Einheit passend zur Einheitenart der Zutat (g/kg, ml/l, Stück, Packung, Bund).
  - **Ohne Menge** bei Gewürzen nach Augenmaß („Pfeffer“, „eine Prise“).
  - **Feste Menge**: Die Zeile skaliert nicht mit den Essern und nicht mit dem Faktor der Einplanung, die Menge ist die Gesamtmenge für jede Einplanung des Gerichts. Beispiele aus dem Sheet: 150 g Vanillepaste im Pudding für alle, 10 glutenfreie Müsliriegel im Lunchpaket, und beim Lagercafé („70 L Teig“, 30 kg Mehl) sind alle Zeilen fest. Fest und skalierend lassen sich in einem Gericht mischen.
  - **In der Datenbank wird nie zwischen Einheitenarten umgerechnet.** Milch steht fest in ml/l. Eine Umrechnungshilfe in der Oberfläche schlägt Werte vor, z. B. EL/TL → g aus den Startdaten, für schwierige Fälle per KI.
  - **Umrechnungshilfe (PR 4c):** Im Dialog einer Zeile mit einer zentralen Zutat, die in g/kg gemessen wird und Werte hat, steht „In Gramm umrechnen“: Anzahl, Maß (TL, EL, Stück) und das Ergebnis; „Übernehmen“ trägt es als Menge in g ein. Unter 10 g auf eine Nachkommastelle, sonst auf ganze Gramm gerundet. Die Werte sind Anhaltspunkte (gestrichen gemessen) und in der Steuerung pflegbar. Fehlt ein Wert, schätzt ihn auf Wunsch die KI (siehe [KI](#ki-azure-openai-gpt-61-sol-datazone)).
- **Für wen gilt eine Zeile:**
  - Häkchen **mit allem / vegetarisch / vegan**. Hackfleisch gilt nur für „mit allem“, Soja-Hack für vegetarisch und vegan.
  - Dazu je Unverträglichkeit „nicht für …“.
  - Eine Ersatzzeile kann „nur für …“ sein, z. B. glutenfreie Nudeln nur für Zöliakie.
- **Warnungen**, die die Seite aus den Merkmalen der Zutat ableitet, bevor man die KI fragt (`gerichtWarnungen` in `api/lib/essen-gerichte-model.ts`):
  - Hackfleisch ist für vegetarisch angehakt (ebenso nicht Veganes für vegan).
  - Eine Ernährungsform bekommt von einem Gericht keine einzige Zeile (Ersatzzeilen „nur für …“ zählen dabei nicht). Ob das an einer Mahlzeit jemanden trifft, hängt an den Teilnehmenden (PR 5).
  - Allergene stehen an der Zeile („enthält Gluten“), solange sie nicht ausgenommen sind. Eine Warnung „Zöliakie, aber Gluten nicht ausgenommen“ kommt mit den Teilnehmenden (PR 5), vorher wäre sie bei jeder Zeile mit Gluten.
- **Zutaten der Planung:** Eine zentrale Zutat wird mit ihrer ersten Zeile zur Zutat der Planung (`planung_zutat`). Dort lassen sich Kategorie und Einheitenart nur für diese Planung ändern (die Einheitenart nur, solange keine Zeile eine Menge in der alten Einheit hat). Eigene Zutaten (Name, Kategorie, Einheitenart, Ernährung, Allergene) legt man im Dialog der Zeile an, wenn der Name nicht in der Liste steht; einen Namen aus der Liste nimmt man aus der Liste. Genutzte Zutaten lassen sich nicht löschen, auch nicht zentral in der Steuerung. Die Steuerung ändert die Einheitenart einer zentralen Zutat nur, solange keine Planung sie mit einer Menge in der bisherigen Einheit erbt; eine Sperre je Zutat (`zutatSperre`) ordnet das gegen gleichzeitig gespeicherte Zeilen.
- Nicht-Lebensmittel gehören in kein Gericht.
- **Rezeptkarte:** „Rezeptkarte als PDF“ lädt dieses Gericht mit Zutaten, Anleitung, Werkzeugen, Links und Notiz herunter, „Alle Rezeptkarten als PDF“ alle Gerichte, eins je Seite.
- Die Anleitung schreibt man im gemeinsamen Editor (`LazyTextEditor`, Markdown); angezeigt wird sie wie Protokolltext (`ProtokollText`, als Svelte-Elemente, nie als HTML).
- Löscht jemand anderes ein Gericht, in dem du gerade ungespeicherte Eingaben hast, zeigt die Seite sie zum Kopieren an (wie bei gelöschten Mahlzeiten).

## Einplanung

- Ein Gericht kommt an eine Mahlzeit, mit Position innerhalb der Mahlzeit (höchstens 10 je Mahlzeit, z. B. Haupt- und Nachspeise). Dasselbe Gericht darf an mehreren Mahlzeiten stehen.
- **Faktor:** Standard 1, z. B. 0,5, wenn nur die Hälfte Nachtisch isst; größer 0 und bis 20, drei Nachkommastellen. Feste Mengen ignorieren ihn.
- **Zuständig:** ein Mitglied der Planung mit Zugang oder ein freier Name, höchstens eins von beiden. Der Lese-Link sieht den Namen, aber keine Mitgliederliste.
- Ein Gericht lässt sich zwischen Mahlzeiten verschieben („Ändern“ mit anderer Mahlzeit) und kopieren (legt eine neue Einplanung mit denselben Angaben an); innerhalb der Mahlzeit mit ↑/↓ sortieren.
- Die Plan-Ansicht zeigt unter jeder Mahlzeit ihre Gerichte mit Faktor und Zuständigen, auch im PDF; die Karte eines Gerichts zeigt, wo es eingeplant ist.
- Jedes eingeplante Gericht hat eine ID `Tag_Mahlzeit_Gericht`, z. B. ist der Salat als zweites Gericht beim Mittagessen (zweite Mahlzeit) am dritten Tag `3_2_2` (`einplanungKennung`); sie folgt der Reihenfolge und steht im Plan, auf der Gerichtskarte und im PDF.
- **Kalender:** Im Plan schaltet „Liste | Kalender“ die Darstellung um; der Browser merkt sich die Wahl (`localStorage`, `essensplanung:darstellung`). Der Kalender (`PlanKalender.svelte`) zeigt die Tage als Spalten, die Mahlzeiten als Zeilen und die eingeplanten Gerichte als Karten mit ID, Portionen, Faktor und Zuständigen; eine Karte öffnet den Dialog zum Ändern, „+ Gericht“ plant ein. Tage und Mahlzeiten ändert man in der Liste.
- Löschen: Ein gelöschtes Gericht verschwindet aus allen Mahlzeiten; eine gelöschte Mahlzeit (oder ihr Tag) nimmt ihre Einplanungen mit, die Gerichte bleiben.

## Teilnehmende

- **Gruppen der Planung** mit Faktor, aus der Vorlage vorbelegt und frei änderbar.
- **Teilnehmenden-Zeilen:** Gruppe × Ernährungsform (mit allem / vegetarisch / vegan) × Unverträglichkeiten (beliebig viele, auch keine) → Anzahl.
  - Beispiel: „Rover, vegan: 2“, „Wölflinge, vegetarisch: 1“.
  - Dazu die **Anwesenheit pro Mahlzeit**: Standard ist die ganze Planung, sonst von Mahlzeit X bis Mahlzeit Y. Beispiel: „bis 3_4“.
- **Einschränkung pro Mahlzeit:** Welche Gruppen essen mit, z. B. „nur Leitende“ an den Aufbau-Tagen oder „ohne Rover“ ab 6_4.
- **Übersicht:** Esser je Mahlzeit, gewichtet und ungewichtet, nach Ernährungsform. So sieht man es auch im Tagesplan des Sheets.

Umgesetzt (PR 5a):

- Eine neue Planung bekommt die Gruppen aus `vorlage_gruppen` der Steuerung; Planungen von vor der Migration `0058` bekommen sie dort. Gruppen haben einen eindeutigen Namen (bis 50 Zeichen) und einen Faktor von 0,01 bis 5; höchstens 20 je Planung. Eine Gruppe mit Teilnehmenden lässt sich nicht löschen.
- Eine Zeile hat Gruppe, Ernährung, Unverträglichkeiten, Anzahl (1 bis 2000), optional „ab“ und „bis“ Mahlzeit (leer: erste bzw. letzte) und einen Hinweis; höchstens 300 Zeilen je Planung.
- „Wer isst mit?“ steht an jeder Mahlzeit mit der Antwort („alle“ oder „alle außer Wö“); „Ändern“ schaltet Gruppen ab (`mahlzeit_ohne_gruppe`).
- Wird eine Mahlzeit oder ein Tag gelöscht, an dem eine Zeile beginnt oder endet, rückt die Grenze auf die nächste verbleibende Mahlzeit (Beginn) bzw. die vorige (Ende). Gibt es keine mehr, bleibt die gelöschte Mahlzeit stehen und die Zeile isst nirgends mit; der Dialog zeigt sie als „Gelöscht“. Liegt der ganze Aufenthalt auf gelöschten Mahlzeiten, bleiben ebenfalls die gelöschten stehen (`api/lib/essen-teilnehmende-grenzen.ts`).
- Verschieben einer Mahlzeit oder eines Tages wird abgelehnt, wenn danach bei einer Zeile das Ende vor dem Beginn läge (`pruefeAnwesenheit`, Feld `anwesenheit`); die Seite nennt Gruppe und Anzahl.
- „Esser je Mahlzeit“ ist ein Kalender: die Tage nebeneinander, ihre Mahlzeiten als Karten mit Personen und Personen je Ernährung (auf dem Handy seitlich zu wischen). Portionen stehen nicht darin, sie sind nur für die Mengen da. Gerechnet wird mit `esserJeMahlzeit` (`api/lib/essen-teilnehmende-model.ts`), das auch die Mengen nutzt (PR 5b).

## Berechnung

Gerechnet wird im Browser aus dem vollständigen Stand der Planung. Das Modul liegt unter `web/src/lib/essensplanungRechnung.ts` und hat Unit-Tests in `web/test/essensplanungRechnung.test.ts`, die **gegen Werte aus dem Sheet geprüft** werden: alle 683 Zeilen von `web/test/fixtures/essensplanung-bezirkslager/` (Abweichung < 0,01) und die gewichteten Esser jeder Mahlzeit.

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

**Summieren und Runden:** Für die Einkaufsliste werden die Mengen je Zutat in der Basiseinheit summiert (`summiere`, getrennt nach Einheitenart). Angezeigt wird ab 1.000 g in kg und ab 1.000 ml in l. Stück, Packung und Bund werden erst **nach dem Summieren** aufgerundet (`einkaufsMenge`). Das Sheet rundet pro Gericht. Wir runden pro Liste, das erzeugt weniger Überschuss.

**Im Plan (PR 5b):** Unter jedem eingeplanten Gericht klappt „Mengen für N Portionen“ die Zutaten mit der Menge für diese Mahlzeit auf (`EinplanungMengen.svelte`, `kochMenge`: ab 1.000 g in kg, nichts aufgerundet). N sind die gewichteten Esser der Mahlzeit mal dem Faktor der Einplanung (bei 0,5 also die Hälfte); jede Zeile nennt wie die Karte des Gerichts, für wen sie ist („nur mit allem“, „nur bei Gluten“, „nicht bei Gluten“, „feste Menge“), und ihre Portionen, wenn es weniger sind; eine Zeile ohne Menge heißt „nach Gefühl“. Die Namen der Unverträglichkeiten lädt der Plan nur, wenn eine Zeile sie braucht. Im PDF des Plans stehen die Mengen immer da, so ist es die Liste der Küche.

## PDF

Ausdrucke sind PDFs, die die Seite selbst baut (jsPDF, erst beim Klick geladen), statt den Druckdialog des Browsers. Die Zeilen kommen aus `web/src/lib/essensplanungDruck.ts` (dieselben Texte wie auf dem Bildschirm, ohne jsPDF und mit Tests), das Layout aus `web/src/lib/essensplanungPdf.ts`; Gemeinsames mit der Abrechnung liegt in `web/src/lib/pdfBasis.ts`. Der Knopf (`PdfKnopf.svelte`) zeigt „PDF wird erstellt …“ und eine Meldung, wenn es nicht klappt.

- **Plan als PDF:** jeder Tag und jede Mahlzeit mit Uhrzeit, ausgelassenen Gruppen und den eingeplanten Gerichten mit Portionen, Zuständigen und den Mengen dieser Mahlzeit (wie „Mengen für N Portionen“).
- **Rezeptkarte als PDF / Alle Rezeptkarten als PDF:** je Gericht eine Seite mit den Zutaten für die Personen des Gerichts (mit „für wen“, Allergenen und „nicht vegetarisch“ wie auf der Karte), Anleitung (Markdown als Absätze und Punkte, Links mit Adresse), Werkzeugen, Links und Notiz. Nur mit der zentralen Liste, damit alle Allergene genannt sind.
- **Esser je Mahlzeit als PDF:** quer, die Tage nebeneinander (höchstens sieben je Tabelle), die Mahlzeiten eines Tages untereinander mit Personen, vegetarisch und vegan; darunter die Teilnehmenden mit Gruppe, Anzahl, Ernährung, Unverträglichkeiten und Zeitraum. Portionen stehen nicht darin, sie sind nur für die Mengen da.
- **Einkaufsliste als PDF:** je Geschäft die Kategorien mit Menge und Zutat und einem Kästchen zum Abhaken.

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
  - Den genauen Algorithmus siehe unten „Umgesetzt (PR 6b)“.
- **Live-Modus** (handytauglich):
  - Die Liste ist nach Kategorie gruppiert, **ein Häkchen** pro Posten.
  - Beim Abhaken trägt man die **tatsächliche Menge** ein, Standard ist die geplante. Fehlendes bleibt offen und erscheint im nächsten Einkauf wieder.
  - **Ersatzprodukt:** „4 l ~~Coca-Cola~~ → Pepsi Cola“ wird im Lager und im Gericht angezeigt, und für den nächsten Einkauf bleibt „1 l Coca-Cola“ übrig.
  - Läuft mit Netz. Offline ist eine spätere Ausbaustufe.
- **Nach jeder Mahlzeit abhaken:**
  - Jede Einplanung wird als **gekocht** markiert, mit den tatsächlich verbrauchten Mengen je Zutat (Standard: geplant, weniger möglich), oder als **ausgelassen**. Auch einzelne Zutaten lassen sich als nicht verwendet markieren.
  - Ausgelassenes geht nicht vom Lager ab. Danach fällt der Bedarf dieser Einplanung weg.
- **Anfangsbestand:** Wird im Lager eingetragen (Zutat, Menge) und mit der Einkaufsliste verrechnet. Beispiel: Spaghetti im Lager werden nicht neu gekauft.

Umgesetzt (PR 5c), Bereich „Einkauf“ (`PlanEinkauf.svelte`):

- **Einkaufsliste** (`web/src/lib/essensplanungEinkauf.ts`): Bedarf aller Einplanungen (`bedarf`) plus Zusatzbedarf, je Zutat und Einheitenart summiert, minus Bestand; was übrig bleibt, wird erst jetzt aufgerundet bzw. in kg/l angezeigt (`einkaufsMenge`). Zutaten, die nur ohne Menge in eingeplanten Gerichten stehen und mitgegessen werden (Pfeffer „nach Gefühl“), kommen ohne Zahl als „nach Gefühl“ dazu, außer es gibt sie schon mit Menge auf der Liste oder im Bestand (`ohneMenge`). Gruppiert nach Geschäft (in der Reihenfolge der Geschäfte, „Ohne Geschäft“ zuletzt) und Kategorie der Zutat. An jedem Posten wählt man das Geschäft der Zutat. „Einkaufsliste als PDF“ lädt die Liste mit einem Kästchen zum Abhaken je Posten herunter.
- **Geschäfte** gehören zur Planung (`essen.geschaeft`, Name eindeutig, höchstens 30); eine Zutat der Planung hat höchstens ein Geschäft (`planung_zutat.geschaeft_id`). Ein gelöschtes Geschäft lässt seine Zutaten ohne Geschäft.
- **Bestand** und **Zusatzbedarf** sind Einträge mit Zutat (aus der Liste oder der Planung, auch Nicht-Lebensmittel wie Spülmittel), Menge, Einheit passend zur Einheitenart und Hinweis (`essen.bestand`, `essen.zusatzbedarf`, je höchstens 500). Eine Zutat, die Bestand oder Zusatzbedarf nutzt, lässt sich nicht löschen und behält ihre Einheitenart, wie bei Gerichten.
- **Freie Posten** (Migration `0060_essensplanung_freie_posten.sql`): Zusatzbedarf geht auch ohne Menge und Einheit (beide `NULL`) und mit einem Namen, der nicht in der Liste steht, z. B. „Kochhandschuhe“. Unter der Einkaufsliste steht dafür „Noch etwas besorgen“ (`NeuerZusatz.svelte`): Enter setzt den Namen ohne Menge auf die Liste; im Dialog „Zusatzbedarf“ ist die Menge optional. Ein Name aus der Liste nimmt diese Zutat, ein Name einer Zutat der Planung diese; sonst entsteht eine eigene Zutat der Planung in der Kategorie „Sonstiges“, die kein Lebensmittel ist (`planung_zutat.lebensmittel = 0`, `sonstigesDerPlanung`) und deshalb in keinem Gericht angeboten wird; gemessen wird sie in der Einheitenart der getippten Einheit, ohne Einheit in Stück. Auf der Liste stehen Posten ohne Menge nur mit ihrem Namen („nach Gefühl“ bleibt den Zeilen der Gerichte ohne Menge), außer es gibt die Zutat schon mit Menge auf der Liste; anders als „nach Gefühl“ stehen sie auch dann darauf, wenn es die Zutat im Bestand gibt, denn sie wurden ausdrücklich auf die Liste gesetzt. Im Dialog „Zusatzbedarf“ übernimmt Enter keinen Vorschlag, ein getippter Name bleibt stehen. Der Bestand braucht weiter eine Zutat und eine Menge.
- Einkäufe und „erhalten“ im Lager siehe „Umgesetzt (PR 6b)“.

Umgesetzt (PR 6a), Kochen abhaken und Lager (Migration `0061_essensplanung_kochen.sql`):

- **Abhaken** (`EinplanungAbhaken.svelte`, im Plan unter jedem eingeplanten Gericht): „Abhaken“ klappt die Zutaten mit Menge auf, vorbelegt mit der geplanten Menge dieser Mahlzeit je Zutat und Einheit (`geplanterVerbrauch`, wie „Mengen für N Portionen“, summiert, ab 1.000 g in kg). Man ändert die Mengen oder wählt „verwendet“ ab (Menge 0) und speichert mit **Gekocht**, oder wählt **Ausgelassen**; **Wieder offen** macht beides rückgängig. Ein gekochtes Gericht zeigt „Verbrauch ändern“ mit dem gespeicherten Verbrauch. Neben dem Namen steht „gekocht“ oder „ausgelassen“, im Plan-PDF in Klammern hinter dem Gericht.
- **Speichern:** `PUT planung/einplanungen/{id}/status` mit `{ etag, status, verbrauch: [{ planungZutatId, menge, einheit }] }` (Logik in `api/lib/essen-kochen.ts`, Prüfung in `essen-kochen-validation.ts`). `einplanung.status` ist `offen`, `gekocht` oder `ausgelassen`; der Verbrauch steht in `essen.einplanung_verbrauch` (je Zutat und Einheit eine Zeile, Menge ab 0, gleiche Zutat und Einheit werden summiert) und wird beim Abhaken als Ganzes ersetzt; nur gekochte Gerichte haben einen. Eine Zutat mit Verbrauch lässt sich nicht löschen; das Löschen des Gerichts oder der Mahlzeit nimmt den Verbrauch mit.
- **Bedarf:** Die Einkaufsliste zählt nur noch offene Einplanungen (`nurOffene`).
- **Lager** (`web/src/lib/essensplanungLager.ts`, Abschnitt „Lager“ im Bereich Einkauf, `PlanLager.svelte`): je Zutat und Einheitenart Bestand vor der Aktion minus Verbrauch gekochter Gerichte (`lager`). Angezeigt werden „Vorher“, „Verbraucht“ und „Übrig“ (nie unter 0), auch als „Lager als PDF“. Die Einkaufsliste zieht ab, was übrig ist (`vorraetig`); ohne Menge Benötigtes („nach Gefühl“) kommt nicht auf die Liste, solange davon etwas übrig ist.

Umgesetzt (PR 6b), Einkäufe und Live-Modus (Migration `0064_essensplanung_einkaeufe.sql`):

- **Einkäufe** (`PlanEinkaeufe.svelte` im Bereich Einkauf zwischen Einkaufsliste und Zusatzbedarf, `EinkaufKarte.svelte`, `EinkaufForm.svelte`): Name, Datum (optional), Geschäft (leer: alle Geschäfte) und „Für die Mahlzeiten bis“ (Auswahl mit Mahlzeit-ID und Name; leer oder eine inzwischen gelöschte Mahlzeit: alle Mahlzeiten). Höchstens 30 je Planung. Jede Karte zeigt, was der Einkauf abdeckt, „N Posten · x von N abgehakt“ und die Knöpfe Einkaufen, Liste, Einkauf als PDF, Ändern, Abschließen/Wieder öffnen und Löschen (mit Rückfrage; gelöscht wird mit `einkaufStand`, der neuesten Version von Einkauf und abgehakten Posten). Anlegen und Ändern passieren in der Seite, ohne Dialog.
- **Liste eines Einkaufs** (`EinkaufListe.svelte`): nach Kategorie, je Posten Menge und Name; „Anpassen“ klappt in der Zeile auf: in einen anderen offenen Einkauf **verschieben** (`POST …/verschieben`: Regel `ohne` hier und `mit` dort in einer Änderung), **feste Menge** (Regel `fest`), **nicht in diesem Einkauf** (Regel `ohne`) und **wieder berechnen** (Regel weg). Herausgenommene Zutaten stehen unter „Nicht in diesem Einkauf“ mit „Zurückholen“ (`POST …/einkaeufe/{id}/zurueckholen` mit `{ planungZutatId }`), das in einer Änderung die Regel `ohne` hier und die Regel `mit` des Einkaufs entfernt, in den sie verschoben wurden; ohne `ohne` hier ändert es nichts (`400`). Für Regeln gilt die letzte Wahl, sie haben keine eigene Version; jede Regeländerung gibt aber dem Einkauf eine neue Version, so dass Löschen mit dem vorher gesehenen `einkaufStand` einen Konflikt ergibt. Eine getippte, nicht gespeicherte feste Menge bleibt beim Öffnen eines anderen Postens erhalten (`einkaufLive.ts`). Während eine Änderung der Liste gespeichert wird, sind ihre Felder und das Öffnen anderer Posten gesperrt; ebenso das Formular „Ändern“ bzw. „Einkauf anlegen“. Wird ein Einkauf gelöscht, in den etwas verschoben war, fällt nur das `ohne` weg, das diese Verschiebung hinterlassen hat (`verschoben_nach`); ein von Hand gesetztes bleibt.
- **Algorithmus** (`web/src/lib/essensplanungEinkaeufe.ts`, `einkaufListen`, Tests in `web/test/essensplanungEinkaeufe.test.ts`), gerechnet je Zutat z und Basiseinheit (g, ml, Stück, Packung, Bund wie bei `summiere`):
  1. Einkäufe in der Reihenfolge (Datum, ohne Datum zuletzt; dann Position).
  2. Bedarf_bis(P, z): offene Einplanungen (`nurOffene`) an Mahlzeiten bis einschließlich P.bis in Plan-Reihenfolge (`mahlzeitenReihenfolge`) plus Zusatzbedarf mit Menge (zählt ab dem ersten Einkauf).
  3. Lager(z): Lager jetzt = Bestand + erhalten (alle abgehakten Posten aller Einkäufe) − Verbrauch gekochter Gerichte (`lager`), unter 0 zählt als 0.
  4. P nimmt z, wenn keine Regel `ohne` besteht und P kein Geschäft hat, z zum Geschäft von P gehört oder eine Regel `mit`/`fest` besteht. Hat ein späterer offener Einkauf eine Regel `mit` für z (z. B. dorthin verschoben), nehmen frühere Einkäufe ohne eigene Regel z nicht: Die Zuordnung bindet den Bedarf an das Ziel, und zwar den ganzen: Mit `mit` zählt der Bedarf aller offenen Mahlzeiten, unabhängig von „bis“ des Ziels.
  5. geplant(P, z) = max(0, Bedarf_bis(P, z) − Lager(z) − unterwegs(z)); bei Regel `fest` genau deren Menge. Stück, Packung und Bund werden aufgerundet, so zählt der nächste Einkauf mit dem, was wirklich gekauft wird.
  6. unterwegs(z) ist die Summe von geplant(Q, z) der früheren Einkäufe Q, die nicht abgeschlossen sind und in denen z noch nicht abgehakt ist. Abgehaktes steckt mit der erhaltenen Menge schon im Lager; erhält man weniger als geplant, bleibt der Rest offen und erscheint im nächsten Einkauf, der z nimmt. Ein abgehakter Posten zeigt die geplante Menge ohne das, was in diesem Einkauf für ihn erhalten wurde.
  7. Ein Haken steht unter dem Schlüssel der festen Menge, wenn der Einkauf eine für die Zutat hat; sonst ein Posten ohne Menge unter `<id>:`, alles andere unter Zutat und Basiseinheit.
  8. Abgeschlossene Einkäufe planen nichts mehr; sie zeigen nur, was abgehakt ist.
  9. Posten ohne Menge (Zeilen „nach Gefühl“, Zusatzbedarf ohne Menge) kommen in den ersten offenen Einkauf, der die Zutat nimmt, solange sie in keinem Einkauf mit Menge stehen und nicht abgehakt sind, nachdem sie auf die Liste kamen (Haken neuer als der neueste mengenlose Zusatzbedarf der Zutat; verglichen wird die `rowversion`, die datenbankweit mit jeder Änderung wächst, so dass auch ein geänderter Zusatzbedarf als neu zählt, `erledigtOhneMenge`); ihr Schlüssel bleibt beim Abhaken ohne Einheit, damit eine offene Zeile im Live-Modus stehen bleibt; „nach Gefühl“ deckt auch das Lager, und ein Haken ohne Menge; ein Haken mit Menge zählt nur über das Lager, ist es verbraucht, wird es wieder gebraucht. In einem Einkauf abgehakt fallen sie auch von der offenen Einkaufsliste.
  - Abweichung vom ersten Entwurf: Statt „Bestand − Verbrauch − Deckung früherer Einkäufe (erhalten oder geplant)“ zieht jeder Einkauf das Lager jetzt ab (mit allem Erhaltenen, auch aus späteren Einkäufen) und nur das, was frühere Einkäufe noch kaufen. Das ist dasselbe, solange in Reihenfolge eingekauft wird, verrechnet aber Erhaltenes auch dann, wenn ein späterer Einkauf zuerst stattfand, und lässt ein Lager unter 0 (mehr verbraucht als erfasst) nicht zu Mehrkauf führen. So passt der letzte Einkauf über alle Mahlzeiten zur offenen Einkaufsliste (Bedarf − Lager jetzt).
- **Live-Modus** (`EinkaufLive.svelte`, `EinkaufLivePosten.svelte`): „Einkaufen“ zeigt große Zeilen nach Kategorie mit einem Kästchen je Posten und „x von N abgehakt“. Antippen klappt die erhaltene Menge (vorbelegt mit der geplanten, Einheit wählbar innerhalb der Einheitenart) und ein Ersatzprodukt auf; „Abhaken“ speichert (`PUT …/einkaeufe/{id}/posten` mit `{ etag, planungZutatId, einheit, erhalten, ersatz }`, `etag` null beim ersten Abhaken). Abgehakte Posten stehen durchgestrichen mit erhaltener Menge, Ersatz („800 g → Vollkornnudeln“) und wer sie abgehakt hat; „Häkchen aufheben“ macht sie wieder offen (`DELETE …/einkauf-posten/{id}`). Posten ohne Menge werden mit leerer Menge (erhalten 0) abgehakt. Mehrere Leute kaufen gleichzeitig: Das Polling zeigt die Häkchen der anderen; hakt jemand denselben Posten ab (oder hebt ihn auf), bevor die eigene Änderung ankommt, gibt es `409`: Die Zeile nennt den neuen Stand, Menge und Ersatz bleiben stehen, und „Trotzdem speichern“ speichert sie auf der neuen Version. Im Wartungsmodus bleiben ein angefangenes Formular und der Live-Modus stehen, gesperrt. Ungespeicherte Eingaben im Live-Modus bleiben beim Wechsel zu Liste oder Ändern erhalten (`einkaufLive.ts`) und werden verworfen, wenn die Seite nach „Änderungen verwerfen“ wirklich verlassen wird; wird während des Speicherns weitergetippt, bleibt das Neue als ungespeicherte Eingabe stehen.
- **Ersatz:** zählt als erhalten für die Zutat; der Text steht im Live-Modus, im Lager unter der Zutat und unter „Mengen für …“ des Gerichts („Nudeln (Spaghetti) → Vollkornnudeln“, `ersatzText`).
- **Lager:** `lager` rechnet jetzt Bestand + erhalten − verbraucht; `PlanLager.svelte` und „Lager als PDF“ zeigen die Spalte „Erhalten“. Die offene Einkaufsliste bleibt Bedarf aller offenen Einplanungen − Lager jetzt.
- **Einkauf als PDF** (`downloadEinkaufPdf`): Name, Planung, was der Einkauf abdeckt, die Liste nach Kategorie mit Kästchen (abgehakte mit „x“ und Ersatz).
- **Lese-Link und Wartung:** Einkäufe und ihre Listen sind sichtbar, PDF geht; Anlegen, Anpassen und Einkaufen nicht.
- Ein Geschäft, das gelöscht wird, lässt seine Einkäufe für alle Geschäfte gelten. Eine Zutat mit abgehakten Posten oder Regeln lässt sich nicht löschen und behält ihre Einheitenart; `deletePlanung` löscht die Einkäufe vor den Zutaten.
- Testdaten der Previews: `api/lib/db-preview-essen-einkaeufe.ts` (`SEEDED_KEY` 41).

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

- Nutzt die Bereitstellung der Belegprüfung (`gpt-6.1-sol-datazone`, Datenzonenstandard, nur EU) über `api/lib/azure-openai.ts` mit Structured Outputs; eingestellt in `CONFIG.essensplanung.ki` (`reasoningEffort: 'low'`). Leerer Endpunkt oder leere Bereitstellung schaltet die KI ab (`503 KI_AUS`), alles andere geht weiter.
- **Wer:** nur Mitglieder mit Bearbeiten-Recht (Besitzer:in, Bearbeiten), nicht mit dem Lese-Link (`403`) und nicht im Wartungsmodus (`503`). Die Knöpfe stehen nur dort, wo man bearbeiten kann.
- **Was an das Modell geht:** Name und Personenzahl des Gerichts, je Zeile Zutat, Einheitenart, Menge, Einheit, „fest“, für wen, „nicht für“/„nur für“ (Namen der Unverträglichkeiten), Hinweis und die Merkmale der Zutat; beim Rezept der eingefügte Text und die Liste der Lebensmittel (Schlüssel, Name, Einheitenart); bei der Umrechnung der Name der Zutat. Nie Namen oder Mailadressen von Mitgliedern, Zuständige, Anleitung oder Notiz. Der Inhalt ist für das Modell nur Datenmaterial. Gespeichert wird nichts, die Seite übernimmt nur, was das Mitglied bestätigt.
- **Gericht prüfen** (Knopf „Gericht prüfen (KI)“ auf der Karte, `GerichtKi.svelte`): Mengen plausibel für die Personenzahl? Tippfehler? Häkchen für Ernährung und Unverträglichkeiten stimmig? Fehlt eine Zutat? Das Ergebnis ist eine Liste von höchstens 20 Hinweisen (`art`, Zeile, Text, Vorschlag), als „von der KI erzeugt und ungeprüft“ gekennzeichnet. Schlägt ein Hinweis eine neue Menge (passend zur Einheitenart der Zutat) oder andere Häkchen vor, übernimmt „Übernehmen: …“ das mit der Version der Zeile, die geprüft wurde; hat jemand die Zeile inzwischen geändert, gibt es einen Konflikt. Die Prüfantwort nennt die Personenzahl, für die geprüft wurde; eine vorgeschlagene Menge wird mit ihr gesendet (`personen` im PATCH der Zeile), und hat das Gericht inzwischen eine andere, antwortet die API `409 PERSONEN_GEAENDERT` (ohne `personen` ändert der PATCH wie bisher). Die Hinweise bieten dann „Gericht neu prüfen“ an. Weitere Hinweise zur selben Zeile bauen nur auf dem eigenen Schreibvorgang auf: Zeigt die Antwort darauf schon eine fremde Änderung der Zeile, verlieren sie ihren Vorschlag („inzwischen auch anderweitig geändert“). Die Zutat selbst schlägt die KI nicht um. Texte stehen in den Worten der Oberfläche („nicht bei …“, „nur bei …“); Feldnamen der Daten, die das Modell doch nennt, ersetzt der Server, Hinweise mit internen IDs fallen weg. Geprüft wird die Antwort in `leseKiPruefung` (`api/lib/essen-ki-model.ts`).
- **Rezept aus Freitext** („Rezept einfügen (KI)“, `RezeptImportDialog.svelte`): Text bis 10.000 Zeichen. Das Modell liest die Zutaten und wählt je Zeile einen Schlüssel der Liste (`p<id>` Zutat der Planung, `z<id>` zentrale Zutat, nur Lebensmittel, jede zentrale einmal); ein erfundener Schlüssel zählt nicht, dann gilt derselbe Name (ohne Groß-/Kleinschreibung), sonst ist die Zeile „nicht in der Liste“ markiert und erst nach einer Wahl dabei. Mengen liest das Modell wie im Rezept; umgerechnet wird in `leseKiRezept` (`api/lib/essen-ki-rezept.ts`): TL/EL in g mit den Werten der Zutatenliste, bei Volumen 5 bzw. 15 ml, Stück in g mit dem Stückgewicht. Nennt die Zeile, was eine Dose, ein Becher, eine Packung oder ein Stück wiegt oder enthält („1 Dose gehackte Tomaten (400 g)“), zählt diese Angabe, wenn sie zur Einheitenart der Zutat passt; bei Zutaten mit Abtropfgewicht (z. B. Kidneybohnen, stückige Tomaten) nur ein ausdrücklich genanntes („Abtropfgewicht 240 g“, „abgetropft 240 g“), sonst bleibt die Menge leer, die Angabe steht im Hinweis und die Zeile ist abgewählt (das Modell liefert sie als `inhaltMenge`/`inhaltEinheit`, sonst liest der Server sie aus der Klammer oder dem Hinweis). Was nicht passt (Prise, EL ohne Wert, Stück bei Gewicht ohne Stückgewicht), bleibt als Hinweis („1 Prise“, „2 EL“). Nennt das Rezept eine Personenzahl, wird auf die Personen des Gerichts skaliert und gerundet wie in der Umrechnungshilfe; sonst stehen die Mengen wie im Rezept, und die Vorschau sagt das. Zutaten, die nicht vegetarisch bzw. vegan sind, gelten nur für „mit allem“ bzw. nicht für vegan. In der Vorschau lassen sich Zeilen abwählen und Zutat, Menge, Einheit und Hinweis ändern. Wählt man für eine Zeile eine Zutat mit anderer Einheitenart, wird Stück mit dem Stückgewicht der Liste in g umgerechnet; sonst wird die Menge geleert, die Angabe des Rezepts steht im Hinweis, und die Zeile ist abgewählt, bis man die Menge einträgt. „Zurück zum Text“ behält die Vorschau samt Korrekturen; bei unverändertem Text führt „Zur Vorschau“ ohne neue Erkennung zurück, und eine neue Erkennung, die Korrekturen ersetzen würde, fragt vorher. Löscht jemand anderes das Gericht, nennt die Seite den eingefügten Text (gekürzt) und die Zahl der bearbeiteten Vorschauzeilen. Ein offener Dialog mit Text oder Vorschau fragt vor dem Verlassen der Seite. Im Wartungsmodus bleiben Dialog, Text und Vorschau; Erkennen und Übernehmen warten, bis er endet. Übernommen wird mit `POST planung/gerichte/{id}/zutaten/sammel` in einer Transaktion, alles oder nichts; Fehler einer Zeile kommen als `zeilen.<index>.<feld>`. Die Seite schickt `personen` mit, für die die Mengen gerechnet sind; hat das Gericht inzwischen eine andere Personenzahl, antwortet der Endpunkt `409 PERSONEN_GEAENDERT`, die Vorschau bleibt, und „Mengen auf N Personen umrechnen“ skaliert sie neu.
- **Umrechnungshilfe** für Fälle ohne Wert in den Startdaten (`KiUmrechnung.svelte` im Dialog der Zeile): Bei einem Lebensmittel in g/kg, dem in der Liste der Wert für TL, EL oder Stück fehlt (eigene Zutaten haben keine), bietet „In Gramm schätzen lassen (KI)“ die fehlenden Maße an. Die KI schätzt die Gramm für eine Einheit (gestrichen), die Seite zeigt „KI-Schätzung, ungeprüft“ mit kurzer Begründung und rechnet mit der Anzahl; „… g übernehmen“ trägt das Ergebnis als Menge in g ein. Eine Antwort gilt nur für die Zutat und die Anfrage, für die sie gestellt wurde; nach einem Zutatenwechsel wird sie verworfen. Unplausible Schätzungen (über 30 g je TL, 60 g je EL, 5 kg je Stück) gelten als „kann die KI nicht schätzen“.
- **Kein Kontingent.** Die Website zählt keine Aufrufe; die Grenze ist das Ratenlimit der Bereitstellung. Meldet sie `429` oder `503` oder überschreitet sie das Zeitlimit (40 s Prüfen, 60 s Rezept, 30 s Umrechnung), antwortet die API mit `429` bzw. `503`, Code `KI_NICHT_VERFUEGBAR`, `Retry-After` (wenn die Bereitstellung eine Wartezeit nennt) und der Meldung „KI gerade nicht verfügbar, bitte in etwa N Sekunden (Minuten) noch einmal versuchen“; ohne Wartezeit „später“. Andere Fehler oder unbrauchbare Antworten ergeben `502 KI_FEHLER`. Alles andere funktioniert weiter.
- **Endpunkte** (`api/endpoints/essensplanung-ki.ts`, Logik in `api/lib/essen-ki.ts`): `POST planung/gerichte/{id}/ki/pruefen`, `POST planung/gerichte/{id}/ki/rezept` mit `{ text }`, `POST planung/ki/umrechnung` mit `{ zutatId | planungZutatId, mass: 'tl' | 'el' | 'stueck' }`, dazu `POST planung/gerichte/{id}/zutaten/sammel` mit `{ zeilen, personen? }`.
- **Mock-API:** Die Demo-KI (`web/dev/mock-data/essensplanung-ki.ts`) antwortet fest: beim Prüfen „Menge wirkt knapp“ (doppelte Menge) für die erste Zeile mit Menge, „nicht vegetarisch“ für Fleisch auf vegetarischen Zeilen und „Salz fehlt vielleicht“; beim Rezept liest sie Zeilen wie „500 g Spaghetti“ oder „für 4 Personen“; die Umrechnung schätzt 4 g je TL, 12 g je EL und 60 g je Stück. Steht „KI-Fehler“ im Namen des Gerichts oder im Rezept, antwortet sie `429` mit `Retry-After: 30`.

## Datenmodell (Schema `essen`, Azure SQL)

Spaltennamen legt der PR fest, der die Tabelle anlegt, und trägt sie hier nach. Angelegt sind bisher die zentralen Tabellen (`api/migrations/0049_essensplanung.sql`, Startdaten in `0050_essensplanung_startdaten.sql`), Planungen mit Anfragen, Mitgliedern, Tagen, Mahlzeiten und Änderungen (`0053_essensplanung_planungen.sql`, `0054_essensplanung_loeschwarnung.sql`) Gerichte mit den Zutaten der Planung (`0055_essensplanung_gerichte.sql`), Einplanungen (`0056`) und Teilnehmende (`0058_essensplanung_teilnehmende.sql`) sowie Geschäfte, Bestand und Zusatzbedarf (`0059_essensplanung_einkaufsliste.sql`, Zusatzbedarf ohne Menge und eigene Nicht-Lebensmittel in `0060_essensplanung_freie_posten.sql`) sowie Status und Verbrauch der Einplanungen (`0061_essensplanung_kochen.sql`) und Einkäufe (`0064_essensplanung_einkaeufe.sql`, Ziel einer Verschiebung in `0066_essensplanung_einkauf_verschoben.sql`); Typen in `api/lib/db-schema.ts`.

| Tabelle | Inhalt |
| --- | --- |
| `einstellungen` | eine Zeile: `anlegen_extern`, `whitelist` (JSON), `aufbewahrung_monate`, `wartung`, `vorlage_gruppen` und `vorlage_mahlzeiten` (JSON), `updated_at`, `updated_by` |
| `audit_log` | Protokoll der Steuerung |
| `kategorie`, `unvertraeglichkeit` (`schluessel` für die 14 EU-Allergene), `zutat`, `zutat_unvertraeglichkeit` | zentrale Listen; `zutat`: `name`, `kategorie_id`, `einheitenart`, `abtropfgewicht`, `lebensmittel`, `vegetarisch`, `vegan`, `merkmale_geprueft`, `hinweis`, `gramm_pro_tl`, `gramm_pro_el`, `gramm_pro_stueck`, `geaendert_am`, `geaendert_von` |
| `anlage_anfrage` | unbestätigte Anlagen (Mail-Bestätigung, 24 h) |
| `planung` | Name, angelegt, Einstellungen (Mitglieder verwalten erlaubt), Hashes von Beitritts- und Lese-Token, `aenderung_seq` |
| `mitglied` | Name, Mail (optional), Rolle, Token-Hash, entzogen |
| `aenderung` | Änderungsprotokoll für Polling und „wer hat was geändert“ |
| `tag`, `mahlzeit` | Tage, Slots (Position, Name, Uhrzeit optional) |
| `planung_gruppe` | Gruppen der Planung: `position`, `name` (eindeutig je Planung), `faktor` |
| `teilnehmende`, `teilnehmende_unvertraeglichkeit` | Zeilen: `gruppe_id` (ohne Kaskade), `ernaehrung` (`alles`/`vegetarisch`/`vegan`), `anzahl`, `von_mahlzeit_id` und `bis_mahlzeit_id` (ohne Fremdschlüssel, `NULL`: erste bzw. letzte Mahlzeit), `hinweis` |
| `mahlzeit_ohne_gruppe` | Gruppen, die an einer Mahlzeit nicht mitessen (Mahlzeit mit Kaskade, Gruppe ohne) |
| `geschaeft` | Geschäfte der Planung: `position`, `name` (eindeutig je Planung) |
| `planung_zutat`, `planung_zutat_unvertraeglichkeit` | jede in der Planung genutzte Zutat: `zutat_id` (zentral) mit den Abweichungen `kategorie_id` und `einheitenart` (`NULL`: wie in der Liste), oder eine eigene mit `name`, `kategorie_id`, `einheitenart`, `vegetarisch`, `vegan` und Allergenen; später das Geschäft |
| `gericht` | `name` (eindeutig je Planung), `personen`, `anleitung`, `notiz`, `links` und `werkzeuge` (JSON, nur mit dem Gericht bearbeitet) |
| `gericht_zutat`, `gericht_zutat_unvertraeglichkeit` | Zeilen: `position`, `planung_zutat_id`, `menge` und `einheit` (beide `NULL` ohne Menge), `fest`, `fuer_alles`/`fuer_vegetarisch`/`fuer_vegan`, `hinweis`; Unverträglichkeiten mit `nur` = 0 („nicht für“) oder 1 („nur für“) |
| `einplanung` | Gericht an Mahlzeit: `mahlzeit_id` (mit Kaskade), `gericht_id` (ohne Kaskade, das Löschen des Gerichts entfernt sie zuerst), `position`, `faktor`, `zustaendig_mitglied_id` oder `zustaendig_text`, `status` (`offen`, `gekocht`, `ausgelassen`) |
| `einplanung_verbrauch` | tatsächlicher Verbrauch je Zutat und Einheit eines gekochten Gerichts (`0061`) |
| `einkauf` | Einkäufe: `position`, `name`, `datum` (optional), `geschaeft_id` (ohne Kaskade, `NULL`: alle Geschäfte), `bis_mahlzeit_id` (ohne Fremdschlüssel, `NULL` oder gelöscht: alle Mahlzeiten), `abgeschlossen` (`0064`) |
| `einkauf_posten` | beim Einkaufen Abgehaktes: `einkauf_id` (Kaskade), `planung_zutat_id` (ohne Kaskade), `einheit`, `erhalten` (ab 0), `ersatz`, `abgehakt_von_mitglied_id`, `abgehakt_am`; eindeutig je Einkauf, Zutat und Einheit, die API hält je Einheitenart einen |
| `einkauf_regel` | Hand-Eingriffe je Einkauf und Zutat (eindeutig): `art` `ohne`, `mit` oder `fest` (nur dann `menge` und `einheit`); `verschoben_nach` (`0066`, ohne Fremdschlüssel) nennt bei einem `ohne` aus dem Verschieben das Ziel |
| `zusatzbedarf`, `bestand` | spontane Dinge, Anfangsbestand: `planung_zutat_id` (ohne Kaskade), `menge`, `einheit`, `hinweis` |
| `packliste_eintrag` | Werkzeuge und eigene Einträge mit Zuständigen und „gepackt“ |

Jede Tabelle mit veränderlichen Zeilen bekommt eine `rowversion`. Löschen einer Planung löscht alles kaskadierend; nur die Zeilen der Gerichte zeigen ohne Kaskade auf die Zutaten der Planung (SQL Server erlaubt keine zwei Kaskadenwege), deshalb löscht `deletePlanung` zuerst die Gerichte.

## Seiten und Endpunkte

- **Öffentliche Seiten:**
  - `/essensplanung` ist der Einstieg: Planung anlegen, Meine Planungen, Erklärung.
  - `/essensplanung/planung#t=…` (bzw. `#r=…` zum Lesen) ist die App mit den Bereichen:
    - Plan (Tage × Mahlzeiten mit Gerichten),
    - Gerichte, Teilnehmende, Einkaufsliste, Einkäufe (mit Live-Modus), Lager, Packliste,
    - Mitglieder & Freigabe, Einstellungen.
  - Die Texte sind neutral für Externe gehalten („Stamm Phoenix stellt das Werkzeug bereit“).
  - Umgesetzt sind bisher Plan (Tage und Mahlzeiten), Gerichte (mit den Zutaten der Planung), Teilnehmende, Mitglieder & Freigabe, Änderungen und Einstellungen. Weitere Seiten: `/essensplanung/bestaetigen#a=…` (Anlegen bestätigen) und `/essensplanung/beitreten#b=…`.
- **API** (`api/endpoints/essensplanung.ts`, Logik in `api/lib/essen-planung.ts`, reine Regeln in `api/lib/essen-planung-model.ts`):
  - ohne Token mit ALTCHA: `POST essensplanung/anlegen`, `POST essensplanung/meine`; mit Anfrage- bzw. Beitrittstoken: `anlegen/bestaetigen`, `beitritt/ansehen`, `beitritt`.
  - mit Header `x-essensplanung-token`: `planung` (GET/PATCH/DELETE), `planung/stand?seit=`, `planung/ich`, `planung/links`, `planung/mitglieder[/{id}[/link]]`, `planung/tage[/{id}]`, `planung/mahlzeiten[/{id}]`, `planung/katalog` (zentrale Listen), `planung/zutaten[/{id}]` (Zutaten der Planung), `planung/gerichte[/{id}[/zutaten]]`, `planung/gericht-zutaten/{id}`, `planung/einplanungen[/{id}]` (Logik in `api/lib/essen-einplanung.ts`), `PUT planung/einplanungen/{id}/status` (Abhaken, `api/endpoints/essensplanung-kochen.ts`), `planung/gruppen[/{id}]`, `planung/teilnehmende[/{id}]`, `PUT planung/mahlzeiten/{id}/gruppen` mit `{ gruppeId, isst }` (Logik in `api/lib/essen-teilnehmende.ts`), `planung/geschaefte[/{id}]`, `PUT planung/zutaten/{id}/geschaeft` mit `{ geschaeftId, etag }` (Version der Zutat), `planung/bestand[/{id}]`, `planung/zusatzbedarf[/{id}]` (Endpunkte in `api/endpoints/essensplanung-einkauf.ts`, Logik in `api/lib/essen-einkauf.ts`; gemeinsamer Handler in `api/lib/essen-planung-http.ts`), `POST planung/einkaeufe`, `PATCH`/`DELETE planung/einkaeufe/{id}`, `PUT planung/einkaeufe/{id}/posten` (Abhaken), `PUT planung/einkaeufe/{id}/regeln` (`{ planungZutatId, art, menge, einheit }`, `art` null nimmt die Regel weg), `POST planung/einkaeufe/{id}/verschieben` (`{ planungZutatId, nachEinkaufId }`), `POST planung/einkaeufe/{id}/zurueckholen` (`{ planungZutatId }`), `DELETE planung/einkauf-posten/{id}` (Endpunkte in `api/endpoints/essensplanung-einkaeufe.ts`, Logik in `api/lib/essen-einkaeufe.ts`, Prüfung in `essen-einkaeufe-validation.ts`, Typen in `essen-einkaeufe-model.ts`). Logik der Gerichte in `api/lib/essen-gerichte.ts` (die Zeilen eines Gerichts in `essen-gericht-zeilen.ts`), Prüfungen in `essen-gerichte-validation.ts`, Typen, Einheiten und Warnungen (auch für die Seite) in `essen-gerichte-model.ts`.
  - `ladeZugang` löst das Token zu Mitglied oder Lese-Link auf; `aendere()` prüft Recht und Wartungsmodus, zählt `aenderung_seq` in derselben Transaktion hoch (das serialisiert auch gleichzeitige Änderungen) und schreibt `essen.aenderung`. Der Lese-Link darf nur `GET`.
  - Konflikte auf Tag oder Mahlzeit (`rowversion`) und `404` antworten mit der aktuellen Ansicht. Die Planung selbst hat keine Version, weil jede Änderung ihre Zeile berührt; Name und Einstellungen gewinnen zuletzt.
- **Gleichzeitig planen:** Die App fragt alle 2,5 s `planung/stand?seit=<stand>`; nur wenn sich etwas geändert hat, kommt die volle Ansicht zurück. Der Stand besteht aus Änderungszähler, Version der Einstellungen und `katalogStand` (neueste Version und Anzahl der zentralen Zutaten, Kategorien und Unverträglichkeiten); ändert sich der Katalogstand, lädt der Bereich Gerichte die zentralen Listen neu.
  - Formulare (Zeile, Zutat der Planung, Kopf des Gerichts) speichern mit der Version, mit der sie geöffnet wurden; hat jemand anderes inzwischen gespeichert, gibt es einen Konflikt, die Eingabe bleibt, und erneutes Speichern übernimmt sie. Dialoge mit ungespeicherten Eingaben fragen vor dem Schließen. Was beim Löschen anderes mitnimmt, wird mit der neuesten Version des Ganzen gelöscht: ein Gericht mit `gerichtStand` (Gericht, Zeilen, Einplanungen), eine Mahlzeit mit `mahlzeitStand` (Mahlzeit, Einplanungen), ein Tag mit `tagStand` (Tag, Mahlzeiten, Einplanungen). So gibt eine während der Rückfrage geänderte oder ergänzte Zeile oder Einplanung einen Konflikt; die Prüfung läuft in `aendere()`, das die Planung sperrt (dazu `gerichtSperre` je Gericht). `ladeAnsicht` liest den Zähler vor den Daten, damit eine Ansicht nie einen neueren Zähler als ihre Daten trägt.
  - Ein Feld, in dem jemand tippt oder das ungespeicherte Eingaben hat, wird nicht überschrieben. Gespeichert werden nur die geänderten Felder; hat jemand anderes dasselbe Feld inzwischen geändert, bleibt die Eingabe stehen und die Seite sagt es.
  - Änderungen laufen nacheinander (`aendern` in `EssensplanungApp.svelte`); ein Feld, das während einer laufenden Speicherung verlassen wird, wird danach gespeichert.
  - Die Bereiche (Plan, Mitglieder, Einstellungen) bleiben beim Wechseln erhalten, ungespeicherte Einstellungen auch.
- **Steuerung:** `/api/intern/essensplanung/steuerung` und `/api/intern/pflege/essensplanung/*`.
- **Mails** (`api/lib/essen-mails.ts`, Absender `kontakt@stamm-phoenix.de`): Bestätigung, Einladung, neuer Link, Meine Planungen, Warnung vor dem Löschen. Previews verschicken keine Mails, die Antwort enthält dann `vorschauLink(s)`. Scheitert eine Mail mit neuem Link, gilt der alte Link weiter (`linkZuruecknehmen`) und ein neuer Versuch geht sofort.
- **Datenschutz:** Abschnitt „Essensplanung“ in `web/src/pages/datenschutz.astro` (auch, was an die KI geht).

## Startdaten

Aus dem Sheet „2026 – Küche Bezirkslager“ (die Datei selbst liegt nicht im Repo):

- **`api/migrations/seed/essensplanung/`:** zentrale Zutatenliste (392 Lebensmittel, 41 Nicht-Lebensmittel), 28 Kategorien, Vorlagen für Gruppen und Mahlzeiten, Umrechnung TL/EL in Gramm, Stückgewichte und die Metro-Artikel des Lagers mit Packung und Preis. Spalten und Herkunft: [README](../api/migrations/seed/essensplanung/README.md). `zutaten_merkmale.csv` enthält die Vorschläge für vegetarisch, vegan und Allergene. Aus den Dateien erzeugt `bun scripts/essensplanung-startdaten.ts` (in `api/`) die Migration `0050_essensplanung_startdaten.sql`; ein Test prüft, dass beide zusammenpassen. `umrechnung_zuordnung.csv` ordnet die Umrechnungstabellen den Zutaten zu; `bun scripts/essensplanung-umrechnung.ts` erzeugt daraus `0057_essensplanung_umrechnung.sql`, die nur leere Felder füllt.
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
- Jede Ansicht gibt es als PDF zum Herunterladen statt über den Druckdialog des Browsers (siehe „PDF“).
- Werkzeuge und Links stehen als JSON am Gericht statt in eigenen Tabellen (PR 4).
- Gericht-Zeilen werden als Ganzes mit ihrer Version gespeichert; der Kopf des Gerichts nur mit den geänderten Feldern und seiner Version (PR 4).
- PR 4 ist geteilt: 4a Gerichte, 4b Einplanung, 4c Umrechnungshilfe.
- Umrechnungshilfe nur für Lebensmittel in g/kg und nur mit eindeutig zugeordneten, gestrichen gemessenen Werten: Werte aus der Tabelle „TL gehäuft / EL“ zählen nicht; widersprechen sich die Tabellen um mehr als die Hälfte oder wiegt ein EL weniger als zwei TL, bleibt der Wert leer (lieber kein Wert als ein falscher) (PR 4c).
- PR 5 ist geteilt: 5a Teilnehmende, 5b Berechnung, 5c Einkaufsliste.
- Die Liste eines Einkaufs wird nicht gespeichert, sondern im Browser gerechnet; gespeichert werden nur Abgehaktes und Regeln. Ein Einkauf zieht das Lager jetzt und das ab, was frühere offene Einkäufe noch kaufen (PR 6b).
- Hand-Eingriffe an Einkäufen (verschieben, feste Menge, herausnehmen) sind Regeln je Einkauf und Zutat ohne Version; die letzte Wahl gilt. Abgehaktes hat eine Version, gleichzeitiges Abhaken desselben Postens gibt einen Konflikt (PR 6b).
- Bestand und Zusatzbedarf verweisen auf Zutaten der Planung (auch Nicht-Lebensmittel), damit Kategorie und Geschäft wie bei Gerichten gelten; das Geschäft hängt an der Zutat, nicht am Posten (PR 5c).
- Die Einkaufsliste zieht den Bestand je Zutat und Einheitenart ab; eine Zutat mit Bestand in g und Bedarf in Stück wird nicht verrechnet (keine Umrechnung zwischen Einheitenarten) (PR 5c).
- Gruppen je Mahlzeit werden als Ausnahme gespeichert („ohne Gruppe“), damit neue Gruppen und neue Mahlzeiten ohne weiteres mitessen (PR 5a).
- Die Grenzen „ab“/„bis“ haben keinen Fremdschlüssel; beim Löschen von Mahlzeiten rücken sie nach, statt die Zeile zu löschen oder auf die ganze Planung zu erweitern (PR 5a).
- Kopieren einer Einplanung legt eine neue an (gleiche Angaben, andere Mahlzeit); Ändern kann die Mahlzeit wechseln, nicht das Gericht (PR 4b).
- Die KI schlägt nur vor: Hinweise und erkannte Rezeptzeilen werden erst gespeichert, wenn ein Mitglied sie bestätigt; die Zeilen eines Rezepts kommen in einer Transaktion (alles oder nichts). Kein eigenes Kontingent, die Grenze ist das Ratenlimit der Bereitstellung (PR 8).
