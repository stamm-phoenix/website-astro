# UI-Animationen

## Bestandsaufnahme und Umsetzung

Die Website verwendet CSS und native Dialoge. Es gibt kein Command-Menü und keine Animationsbibliothek. Filter und echte Tabs wechseln direkt. Ladezustände, Uploadfortschritt und Erfolgsmeldungen folgen weiterhin den echten Anfragen; künstliche Wartezeiten und Prozentwerte werden nicht ergänzt.

- Öffentliche Navigation: 160 ms für Deckkraft und 4 px Bewegung von der Kopfzeile zum Panel. Das Panel bleibt montiert, damit CSS bei Richtungswechseln vom aktuellen Wert umkehrt. `inert` und Zeigerbedienung folgen dem Zustand sofort; nur die Sichtbarkeit wartet beim Schließen auf das Ausblenden. Animationen haben keine Abschluss-Handler oder Timer.
- Desktop-Untermenü: kurze Einblendung unter dem tatsächlichen Auslöser. Das native `details` schließt sofort.
- Gemeinsamer Dialog: 160 ms Deckkraft, 220 ms für 8 px Bewegung; mobile Aktionsblätter beginnen 16 px weiter unten. Schließen, Ergebnisse und Fokusrückgabe warten nicht auf Animationen. Ein verspätetes natives `close`-Ereignis wird nach erneutem Öffnen ignoriert. Escape respektiert `closeDisabled`.
- Hinweise: 160 ms Einblendung aus 4 px Abstand. Die Live-Region bleibt montiert. Schließen entfernt Meldung und Aktion sofort; die bestehende Lesedauer läuft unabhängig vom Übergang.
- Hamburger: nur `transform` und `opacity`, 160 ms mit ease-in-out für den Positionswechsel. Pauschale Header-Übergänge und die globale Seitenüberblendung entfallen. Gedrückte Buttons rücken ohne Übergang 1 px nach unten und werden dunkler; bei Reduced Motion bleibt nur die Abdunklung. Allgemeine Buttons ändern nur benannte Farben. Filter und Tageswechsel bleiben unmittelbar.
- Reduced Motion: Menübewegung und das Verschieben gedrückter Buttons entfallen, neue Dialog-/Hinweisübergänge sind abgeschaltet, bestehende CSS-Übergänge und ihre Verzögerungen werden reduziert. JavaScript-Scrollaktionen in Buchung, Terminverwaltung, Foto-Upload, Abrechnung und Protokollen lesen die aktuelle Präferenz beim Scrollen und verwenden bei Reduktion `instant`.

Die Werte stehen in `global.css`. Einblendungen verwenden ease-out, der Hamburger ease-in-out. Bounce gibt es nicht. Wiederholte Einblendungen von Seiteninhalten bleiben gemäß dem [UI-Leitfaden](leitfaden.md) aus. Browser ohne `@starting-style` zeigen neue Inhalte unmittelbar an.

## Gesten

Auf Handys folgen fünf Elemente dem Finger. Jede Geste hat eine Schaltfläche oder Taste mit demselben Ergebnis, sie ist also nie der einzige Weg.

| Element                                                                        | Geste                                                | Ergebnis                                                                                                           | Schaltfläche/Taste          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Leitendenmenü „Alle Bereiche“ (`StaffNav.svelte`)                              | Leiste nach oben, Blatt nach unten                   | öffnet bzw. schließt ab einem Viertel bzw. Drittel der Höhe                                                        | „Menü“, „Schließen“, Escape |
| Aktionsblatt (`ModalDialog.svelte` mit `sheet`, unter 640 px)                  | nach unten ziehen, am Kopf oder bei Inhalt ganz oben | schließt ab einem Drittel der Höhe über `onclose`; nicht bei `closeDisabled`                                       | „Schließen“, Escape         |
| Hinweis (`Toast.svelte`)                                                       | zur Seite wischen                                    | schließt ab 40 % der Breite; die Lesedauer pausiert, solange ein Finger aufliegt                                   | „Hinweis schließen“         |
| Große Fotoansicht (`FotoDetail.svelte`)                                        | zur Seite wischen                                    | nächstes oder vorheriges Foto ab einem Viertel der Breite; am ersten und letzten Foto gibt das Bild nur 24 px nach | Pfeiltasten, Schaltflächen  |
| Instagram-Beitrag im Dialog (`InstagramPostImages.svelte`, nur mehrere Bilder) | zur Seite wischen                                    | nächstes oder vorheriges Bild ab einem Viertel der Breite; der Zähler zeigt das Ziel sofort                        | Pfeil-Schaltflächen         |

Gemeinsame Regeln in `lib/swipe.ts`:

- Eine Geste beginnt erst nach 8 px in ihrer Richtung. Bewegt sich der Finger eher quer dazu, bleibt die Berührung beim Browser (Scrollen, Zoomen). Erst danach wird `preventDefault` aufgerufen; nach einer Geste löst die Berührung keinen Klick aus.
- Beim Loslassen entscheidet `commits`: über der Schwelle oder ein Wisch mit mindestens 0,5 px/ms in Richtung der Geste führt sie aus. Ein Wisch zurück bricht sie auch über der Schwelle ab. Ruhte der Finger vor dem Loslassen länger als 100 ms, zählt seine Geschwindigkeit nicht.
- Zustand, Fokus und Ergebnis ändern sich beim Loslassen sofort. Ein neues Foto erscheint an seinem Platz, ohne von der alten Position einzurutschen.
- Der Rest der Bewegung startet mit der Geschwindigkeit des Fingers: `settleDuration` verkürzt die Dauer (`--motion-panel`, mindestens 120 ms) für schnelle Finger, `settleEasing` flacht den Anfang von `--motion-enter` für langsame ab. So springt nichts beim Loslassen. Statt einer Spring-Bibliothek reicht diese Kurve, weil keine der Gesten nachfedern soll.
- Reduced Motion: Die Elemente folgen weiter dem Finger, weil das direkte Bedienung ist. Der Rest der Bewegung entfällt, denn `panelDuration()` liest `--motion-panel`, das dann 0 ms ist.

## Durchgeführte Prüfungen

Lokal mit erfundenen Daten (`CONTENT_SOURCE=mock`, `MOCK_API=1`) in Chromium, einschließlich 390 × 844 px und 1536 × 960 px:

- `bun run check` in `web/`: ESLint, Astro-/Svelte-Prüfung und alle 33 Unit-Tests erfolgreich. Die danach ergänzten Browsertests und der Scrollhelfer wurden zusätzlich mit ESLint geprüft.
- `bun run build` in `web/`: statischer Produktionsbuild erfolgreich.
- Bestehende Browserprüfungen: `detail-dialogs.spec.ts` (3), `filter-tabs.spec.ts` (4), `ladezustand.spec.ts` (2), `public-flows.spec.ts` (3). Geprüft wurden Dialogname, Hintergrundklick, Fokus, Filtermarkierung, Kontrastmodus, Ladefehler mit Wiederholung und weiter sichtbaren Bestandsdaten sowie Tastatur-/Astro-Navigation.
- Neue Prüfungen in `motion.spec.ts` (6): Umkehr eines laufenden Übergangs ohne Sprung, sofortiges `inert`, Enter/Escape/Tab, Fokusrückgabe, Reduced Motion während des Besuchs, wiederholtes Öffnen/Schließen eines Dialogs, ausstehendes/fehlgeschlagenes Speichern ohne falschen Erfolg mit erhaltenen Eingaben. Außerdem Desktop-Menüanker, Pfeiltastennavigation und tatsächliche JavaScript-Scrollanforderungen der Abrechnung. Zusätzlich bestätigt ein Hinweis erst die abgeschlossene Ladeanfrage und lässt sich sofort per Tastatur schließen, mit und ohne Reduced Motion. Alle sechs bestehen in Chromium für die Projekte `desktop` und `mobile`, zusammen mit `theme.spec.ts` (gedrückter Zustand) und `protokoll-termin.spec.ts`.
- Visuell geprüft: Bearbeitungsdialog auf 390 px sowie öffentliches Desktop-Untermenü. Keine horizontale Überbreite in den geprüften Handyabläufen. Die Dialogöffnung hatte im Browser tatsächlich laufende Übergänge für `opacity` und `transform`.
- Rendering-Stichprobe über Chromiums Performance-Protokoll: sechs Menüwechsel über 36 Frames, **0 zusätzliche Layouts / 0 ms Layoutzeit**, etwa **10,8 ms Style-Neuberechnung** und **81,9 ms Taskzeit** im gesamten Messfenster. Mittlerer Frame-Abstand etwa **16,1 ms**, größter **28 ms**. Lokale Stichprobe einschließlich Testausführung, keine Zusage für andere Geräte. Der Browsertest hängt Messwerte als JSON an.

- Gesten: Unit-Tests für `lib/swipe.ts` (`test/swipe.test.ts`) und Browserprüfungen im Projekt `mobile`: `gestures-staff.spec.ts` (schneller Wisch endet kürzer als langsames Ziehen, kurzes Ziehen federt zurück, Reduced Motion ohne Übergang), `gestures-sheet.spec.ts` (Aktionsblatt schließt mit Fokusrückgabe oder bleibt offen, Hinweis wird weggewischt oder bleibt), `gestures-media.spec.ts` (Foto wechselt bei Ziehen und Wischen, bleibt bei kurzem Ziehen und am Ende, Instagram-Bild wechselt). Jede dieser Prüfungen schlug fehl, als das geprüfte Verhalten testweise entfernt wurde. Einmalig im Browser geprüft: Ein Hinweis, der langsam zurückgeführt und losgelassen wird, kehrt mit `cubic-bezier(0.16, 0.135, 0.3, 1)` statt `--motion-enter` zurück.

Nicht geprüft: echte Mobilgeräte, echte Berührungen statt per Skript erzeugter, Gesten auf einem Video mit Bedienelementen, Safari/WebKit, Firefox, Screenreader-Ausgabe, produktive Anmeldung/Backend-Anfragen, alle einzelnen Upload-/Protokollabläufe und Leistung langsamer Endgeräte. Status- und Fokussemantik wurden im Chromium-Browser geprüft, die Sprachausgabe nicht.
