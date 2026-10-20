# Leitendenbereich als App

Leitende können den Leitendenbereich auf den Startbildschirm legen. Er öffnet sich dann in einem eigenen Fenster ohne Adressleiste, mit dem Phoenix-Icon und dem Namen „Leitende“.

## Installieren

- **Android (Chrome):** `/leitendenbereich/` öffnen, im Menü **App installieren** oder **Zum Startbildschirm hinzufügen** wählen.
- **iPhone und iPad (Safari, ab iOS 16.4):** `/leitendenbereich/` öffnen, **Teilen** antippen und **Zum Home-Bildschirm** wählen.
- **Computer (Chrome, Edge):** `/leitendenbereich/` öffnen und auf das Installieren-Symbol in der Adressleiste klicken.

## Bausteine

| Datei                                                          | Aufgabe                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `web/public/leitendenbereich.webmanifest`                      | Name, Start-URL, Scope, Farben und Icons der App                                                                                  |
| `web/src/pages/leitendenbereich-app.astro`                     | Startseite der App, leitet zur Übersicht oder zur Anmeldung weiter                                                                |
| `web/src/layouts/StaffLayout.astro`                            | Verlinkt das Manifest und das Apple-Icon nur auf Seiten des Leitendenbereichs. Zeigt ohne Verbindung einen Hinweis oben im Inhalt |
| `web/public/app-icon-*.png`, `web/public/apple-touch-icon.png` | Icons, erzeugt mit `bun scripts/app-icons.ts` (in `web/`) aus `src/assets/stammeslilie.svg`                                       |
| `web/public/staticwebapp.config.json`                          | `mimeTypes` liefert das Manifest als `application/manifest+json` aus                                                              |

## Start über `/leitendenbereich-app/`

Die App startet auf `/leitendenbereich-app/`, nicht direkt auf `/leitendenbereich/`. Ohne Anmeldung leitet die Static Web App `/leitendenbereich/` zur Anmeldung weiter und schickt danach zurück zum Referrer (`.referrer` in `staticwebapp.config.json`). Ein Start vom Startbildschirm hat keinen Referrer. Die Startseite fragt deshalb `/.auth/me` und öffnet `/leitendenbereich/`, wenn jemand angemeldet ist, sonst `/login`. `/login` führt nach der Anmeldung immer in den Leitendenbereich. Fehlt die Verbindung, sagt die Startseite das und bietet **Noch einmal versuchen** an.

Das Manifest liegt außerhalb von `/leitendenbereich/`, weil die Static Web App dort eine Anmeldung verlangt. Der Browser lädt das Manifest ohne Anmelde-Cookie.

## Kein Service Worker

Die App installiert keinen Service Worker. Chrome, Edge und Safari bieten die Installation auch ohne Service Worker an. Chrome meldet für `/leitendenbereich/` keine Installationsfehler (`Page.getInstallabilityErrors` liefert eine leere Liste).

Ohne Service Worker legt die App keinen eigenen Zwischenspeicher an. Es gilt nur der normale HTTP-Cache des Browsers nach den Headern der Antworten: Seiten des Leitendenbereichs kommen mit `Cache-Control: no-store`, die Vorschaubilder der Belege mit `private, max-age=300` und können also bis zu fünf Minuten im Browser liegen. Nach einem Deploy lädt die App sofort den neuen Stand. Offline-Speicher gibt es nur dort, wo ein Modul ihn selbst anbietet, zum Beispiel die Fahrtansicht (`docs/nikolaus-offline.md`).

Ohne Verbindung gilt:

- Eine offene Seite bleibt sichtbar. `StaffLayout.astro` sagt, dass die Seite offen bleiben soll, die Eingaben stehen bleiben und Speichern erst mit Verbindung geht.
- Die Fahrtansicht und der Protokoll-Editor sagen selbst, was ohne Verbindung geht. Sie schalten den allgemeinen Hinweis mit `offlineNotice={false}` ab. Die Abrechnung ersetzt den Text des Hinweises über den Slot `offline` von `StaffLayout.astro`. Er sagt nur, dass die Eingaben auf der offenen Seite stehen bleiben, denn ob sie auch auf dem Gerät gespeichert werden, zeigt die Abrechnung selbst an. Bei vollem Speicher oder nach Ablauf der Frist speichert sie dort nicht.
- Wer die App ohne Verbindung neu startet, sieht die Fehlerseite des Browsers. Eine eigene Seite dafür bräuchte einen Service Worker.

## Scope `/` statt `/leitendenbereich/`

Der Scope der App ist die ganze Website. Anmeldung und Abmeldung laufen über Adressen außerhalb von `/leitendenbereich/`: `/login`, `/logout`, `/.auth/…` und `/abgemeldet`. Läge der Scope auf `/leitendenbereich/`, öffnete iOS einen Klick auf **Abmelden** in einem Safari-Fenster über der App. Dieses Fenster hat eigene Cookies, die Abmeldung erreichte die App also nicht. Mit Scope `/` bleiben alle diese Seiten im App-Fenster.

Die Folge: Öffentliche Seiten wie „Zur Website“ erscheinen ebenfalls im App-Fenster. Unter Android kann ein Link auf `www.stamm-phoenix.de` aus einer anderen App direkt in der installierten App landen.

## Grenzen der Plattformen

- **iOS hat eigene Cookies pro installierter App.** Eine Anmeldung in Safari gilt nicht in der App. Beim ersten Start meldet man sich in der App an.
- **iOS öffnet neue Tabs außerhalb der App.** Nach einer abgelaufenen Anmeldung öffnet „Neu anmelden (öffnet neuen Tab)“ (`RELOGIN_URL` in `web/src/lib/api.ts`) ein Safari-Fenster mit eigenen Cookies, die neue Anmeldung erreicht die App also nicht. In der iPhone-App (`navigator.standalone`, `reloginOnlyHere()`) meldet **Neu anmelden** deshalb im selben Fenster neu an und kehrt zur Seite zurück. Liegt der Knopf in einem Bearbeitungsdialog (`EditDialog`), sichert dieser vorher alle Felder im Tab-Speicher (`web/src/lib/geretteteEingaben.ts`, höchstens eine Stunde): Text, Häkchen, Auswahlknöpfe, Listen und den Inhalt der Text-Editoren samt Links. Öffnet man denselben Dialog nach der Anmeldung auf derselben Seite wieder, setzt er die Werte selbst ein und sagt das. Das gilt nur für Dialoge, die mit `rescueKey` ihren Datensatz nennen (etwa `frage:12` oder `frage:neu`), alle anderen zeigen den Hinweis zum Kopieren. Derselbe Dialog heißt: gleicher `rescueKey`, gleiche Datensatzversion (`rescueVersion`) und gleiche Werte beim Öffnen. Damit zählen auch inzwischen gespeicherte Änderungen am Inhalt eines Text-Editors. Ein später zum Übernehmen gewählter Kalendereintrag wird zusätzlich mit seiner Kennung und der bei der Auswahl geltenden Version gesichert; vor jedem Einsetzen muss auch diese Version noch stimmen. Bei einer anderen Version bleibt die aktuelle Fassung unverändert; die früheren Eingaben stehen zum Kopieren unter „Noch nicht eingesetzt“, auch bewusst geleerte Felder und entfernte Häkchen. Formatierte Texte erscheinen dort lesbar und werden mit Formatierung und Links kopiert; normale Formularwerte bleiben Klartext. Sie werden auch bei später geladenen Feldern nicht automatisch eingesetzt. Eine weitere Anmeldung verlangt dann das Kopieren der Eingaben, damit die frühere Rettung nicht überschrieben wird. Mehrere Aufgaben teilen sich den Titel „Aufgabe bearbeiten“ und können gleiche Werte haben, deshalb entscheidet die Kennung. Zusammengesetzte Werte werden über `rescueFields` gesichert: ausgewählte Zuständige mit Namen und Identität; bei gespeicherten Vorlagen außerdem die Zeilenanzahl. Die Zeilenanzahl wird vor den Feldwerten eingesetzt, damit entfernte Aufgaben nicht wiederkehren. Bei neuen Vorlagen bleiben fehlende zusätzliche Zeilen wie bisher unter „Noch nicht eingesetzt“. Eine zweite neue Anmeldung behält auch Werte, die noch kein Feld hatten oder auf eine noch fehlende Auswahloption warten. Erst erfolgreiches Einsetzen oder eine bewusste Änderung am Feld ersetzt diesen wartenden Wert. Wird eine Person neu angelegt und der Dialog bleibt für ihr Foto offen, übernimmt er die neue Kennung und die gespeicherten Ausgangswerte. Bestätigt die API ein im offenen Dialog gespeichertes oder entferntes Foto, übernimmt `acceptRescueVersion()` nur diese neue Version, ohne ungespeicherte Textwerte als Ausgangswerte zu übernehmen. Andere Versionsänderungen werden weiterhin als Konflikt erkannt. Zuerst setzt der Dialog Auswahllisten und Auswahlknöpfe ein, erst nach dem nächsten Rendern Häkchen und Text, denn eine Auswahl kann andere Felder ändern. Eine Auswahl, deren Option noch lädt, wartet auf die Option. Fehlt einem Wert das Feld, etwa eine weitere Zeile einer Vorlage, zeigt der Dialog ihn unter „Noch nicht eingesetzt“ mit einem Kopieren-Knopf. Sobald man die Zeile anlegt, setzt der Dialog den Wert selbst ein. Die Rettung bleibt gespeichert, bis alles eingesetzt ist, der Dialog nach dem Einsetzen gespeichert wurde, man die Änderungen ausdrücklich verwirft oder die Rettung löscht. Als gespeichert gilt, wenn der wieder ausgefüllte Dialog schließt oder verschwindet, ohne dass man das Verwerfen bestätigt hat. Bis dahin nennt `GeretteteEingaben.svelte` oben im Inhalt den Dialog. Lässt sich nichts sichern, etwa bei vollem Speicher, bleibt die Seite stehen und der Hinweis bittet, die Eingaben selbst zu kopieren. Außerhalb eines Bearbeitungsdialogs sagt der Hinweis gleich, dass man die Eingaben vorher kopieren soll. Ausgewählte Fotos beim Hochladen lassen sich so nicht aufheben, dort sagt der Hinweis, welche man danach noch einmal hochlädt. Android teilt die Cookies zwischen App und Chrome, dort bleibt der neue Tab. Links mit `target="_blank"` auf geschützte Seiten (`/leitendenbereich/…`, `/api/intern/…`, etwa das Foto eines Belegs) schickt ein Klick-Handler in `StaffLayout.astro` deshalb zuerst zur Anmeldung in Safari und danach zum Ziel. Auch „Präsentation öffnen“ im Protokoll-Editor öffnet dort ein Safari-Fenster. `openPraesentation()` schickt es deshalb zuerst zur Anmeldung und danach zur Präsentation. Sie zeigt dort den gespeicherten Stand, weil der Kanal zum Schreib-Tab nur innerhalb eines Browsers reicht.
- **iOS nutzt das Apple-Icon.** Safari liest für den Startbildschirm `apple-touch-icon.png` und den Titel aus `apple-mobile-web-app-title`.
- **Android schneidet das Icon zu.** Der Launcher nutzt `app-icon-maskable-512.png` und schneidet es rund oder eckig zu. Die Lilie liegt deshalb mit mehr Rand in der sicheren Zone.
- **Chrome färbt die Statusleiste nach der Seite.** Chrome nimmt für die Statusleiste die `theme-color`, die `BaseLayout.astro` und `web/src/lib/theme.ts` für das helle oder dunkle Thema setzen, auch nach dem Umschalten in der App. Die Navigationsleiste unten nimmt ab Chrome 156 die `theme_color` aus dem Manifest.
- **Firefox färbt nur nach dem Manifest.** Die installierte Firefox-App nimmt für die Statusleiste die `theme_color` und macht die Navigationsleiste schwarz oder weiß, je nachdem wie dunkel `background_color` ist (`toCustomTabConfig()` in android-components). Die Seite und ihr Thema ändern daran nichts.
- **Ein Manifest kennt nur eine Farbe.** Dunkle Varianten gibt es erst als Vorschlag ([w3c/manifest#1207](https://github.com/w3c/manifest/pull/1207)). `theme_color` ist deshalb das dunkle `#101b26`, `background_color` (Startbildschirm) DPSG-Blau `#003056`. Im hellen Modus bleiben damit in Firefox beide Leisten und in Chrome die untere dunkel.

## Auf Geräten prüfen

Diese Schritte sind auf einem Android-Gerät und einem iPhone durchzugehen:

1. Die App wie oben beschrieben installieren. Icon und Name auf dem Startbildschirm prüfen.
2. Die App starten. Sie öffnet sich ohne Adressleiste und fragt nach der Anmeldung.
3. Anmelden. Die App zeigt danach die Übersicht des Leitendenbereichs.
4. Ein Modul öffnen, die App schließen und wieder starten. Die Anmeldung besteht noch.
5. **Abmelden** antippen. Die App zeigt „Du bist abgemeldet“. Danach die App neu starten: Sie fragt wieder nach der Anmeldung.
6. Den Flugmodus einschalten. Auf einer offenen Seite erscheint „Keine Verbindung zum Internet.“.
7. Nur iPhone: Die App nach einer längeren Pause wieder öffnen, bis die Anmeldung abgelaufen ist. Dann etwas speichern, **Neu anmelden** antippen und prüfen, dass Speichern danach wieder klappt.
