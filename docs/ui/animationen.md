# UI-Animationen

## Bestandsaufnahme und Umsetzung

Die Website verwendet CSS und native Dialoge. Es gibt kein Command-Menü und keine Animationsbibliothek. Filter und echte Tabs wechseln direkt. Ladezustände, Uploadfortschritt und Erfolgsmeldungen folgen weiterhin den echten Anfragen; künstliche Wartezeiten und Prozentwerte werden nicht ergänzt.

- Öffentliche Navigation und Leitendenmenü: 160 ms für Deckkraft und 4 px Bewegung von der Kopfzeile zum Panel. Die Panels bleiben montiert, damit CSS bei Richtungswechseln vom aktuellen Wert umkehrt. `inert` und Zeigerbedienung folgen dem Zustand sofort; nur die Sichtbarkeit wartet beim Schließen auf das Ausblenden. Animationen haben keine Abschluss-Handler oder Timer.
- Desktop-Untermenü: kurze Einblendung unter dem tatsächlichen Auslöser. Das native `details` schließt sofort.
- Gemeinsamer Dialog: 160 ms Deckkraft, 220 ms für 8 px Bewegung; mobile Aktionsblätter beginnen 16 px weiter unten. Schließen, Ergebnisse und Fokusrückgabe warten nicht auf Animationen. Ein verspätetes natives `close`-Ereignis wird nach erneutem Öffnen ignoriert. Escape respektiert `closeDisabled`.
- Hinweise: 160 ms Einblendung aus 4 px Abstand. Die Live-Region bleibt montiert. Schließen entfernt Meldung und Aktion sofort; die bestehende Lesedauer läuft unabhängig vom Übergang.
- Hamburger: nur `transform` und `opacity`, 160 ms mit ease-in-out für den Positionswechsel. Pauschale Header-Übergänge, das Verschieben aller gedrückten Buttons und die globale Seitenüberblendung entfallen. Allgemeine Buttons ändern nur benannte Farben. Filter und Tageswechsel bleiben unmittelbar.
- Reduced Motion: Menübewegung entfällt, neue Dialog-/Hinweisübergänge sind abgeschaltet, bestehende CSS-Übergänge und ihre Verzögerungen werden reduziert. JavaScript-Scrollaktionen in Buchung, Terminverwaltung, Foto-Upload, Abrechnung und Protokollen lesen die aktuelle Präferenz beim Scrollen und verwenden bei Reduktion `instant`.

Die Werte stehen in `global.css`. Einblendungen verwenden ease-out, der Hamburger ease-in-out. Springs und Bounce sind für diese Aktionen ohne Gesten nicht nötig. Wiederholte Einblendungen von Seiteninhalten bleiben gemäß dem [UI-Leitfaden](leitfaden.md) aus. Browser ohne `@starting-style` zeigen neue Inhalte unmittelbar an.

## Durchgeführte Prüfungen

Lokal mit erfundenen Daten (`CONTENT_SOURCE=mock`, `MOCK_API=1`) in Chromium, einschließlich 390 × 844 px und 1536 × 960 px:

- `bun run check` in `web/`: ESLint, Astro-/Svelte-Prüfung und alle 33 Unit-Tests erfolgreich. Die danach ergänzten Browsertests und der Scrollhelfer wurden zusätzlich mit ESLint geprüft.
- `bun run build` in `web/`: statischer Produktionsbuild erfolgreich.
- Bestehende Browserprüfungen: `detail-dialogs.spec.ts` (3), `filter-tabs.spec.ts` (4), `ladezustand.spec.ts` (2), `public-flows.spec.ts` (3). Geprüft wurden Dialogname, Hintergrundklick, Fokus, Filtermarkierung, Kontrastmodus, Ladefehler mit Wiederholung und weiter sichtbaren Bestandsdaten sowie Tastatur-/Astro-Navigation.
- Neue Prüfungen in `motion.spec.ts` (7): Umkehr eines laufenden Übergangs ohne Sprung, sofortiges `inert`, Enter/Escape/Tab, Fokusrückgabe, Reduced Motion während des Besuchs, wiederholtes Öffnen/Schließen eines Dialogs, ausstehendes/fehlgeschlagenes Speichern ohne falschen Erfolg mit erhaltenen Eingaben. Außerdem Desktop-Menüanker, Pfeiltastennavigation und tatsächliche JavaScript-Scrollanforderungen der Abrechnung. Zusätzlich bestätigt ein Hinweis erst die abgeschlossene Ladeanfrage und lässt sich sofort per Tastatur schließen, mit und ohne Reduced Motion. Nach Korrektur fehlerhafter Testabfragen bestanden alle sieben; Scroll- und Hinweisprüfung wurden separat ausgeführt.
- Visuell geprüft: Leitendenmenü und Bearbeitungsdialog auf 390 px sowie öffentliches Desktop-Untermenü. Keine horizontale Überbreite in den geprüften Handyabläufen. Die Dialogöffnung hatte im Browser tatsächlich laufende Übergänge für `opacity` und `transform`.
- Rendering-Stichprobe über Chromiums Performance-Protokoll: sechs Menüwechsel über 36 Frames, **0 zusätzliche Layouts / 0 ms Layoutzeit**, etwa **10,8 ms Style-Neuberechnung** und **81,9 ms Taskzeit** im gesamten Messfenster. Mittlerer Frame-Abstand etwa **16,1 ms**, größter **28 ms**. Lokale Stichprobe einschließlich Testausführung, keine Zusage für andere Geräte. Der Browsertest hängt Messwerte als JSON an.

Nicht geprüft: echte Mobilgeräte, Safari/WebKit, Firefox, Screenreader-Ausgabe, produktive Anmeldung/Backend-Anfragen, alle einzelnen Upload-/Protokollabläufe und Leistung langsamer Endgeräte. Status- und Fokussemantik wurden im Chromium-Browser geprüft, die Sprachausgabe nicht.
