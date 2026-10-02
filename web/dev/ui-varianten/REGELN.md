# Gestaltungsregeln „Fahrtenbuch“ (Issue #97)

Ziel: ruhig, gedruckt wirkend, wie ein Fahrtenbuch – nicht wie ein generisches KI-/SaaS-Template.
Farben nur aus dem DPSG-Leitfaden: Blau #003056 (Tinte), Rot #810a1a (Stempel/Akzent),
Hellbeige #ecdfcb / Mittelbeige #c7bdad (Papier/Linien), Stufenfarben nur zur Kennzeichnung von Stufen.

## Verboten / abbauen

1. **Keine Pills.** Kein `rounded-full` für Labels, Status, Filter, Zähler, Buttons, Tabs.
   Erlaubt bleibt `rounded-full` nur für echte Kreise: Avatare/Fotos, Status-Punkte (≤ 0.75rem),
   Spinner, Kartenmarker, Fortschritts-Punkte.
   - Status/Labels → einfacher Text, ggf. mit kleinem Farbpunkt davor oder `font-semibold` in Stufen-/Statusfarbe.
   - Filter → schlichte Textschalter mit Unterstrich für den aktiven Zustand (`aria-pressed`) oder eine
     Zeile normaler Buttons (`btn-secondary`).
   - Zähler → Text in Klammern oder `tabular-nums`, kein Bubble.
2. **Keine Box in der Box.** Pro Bereich höchstens eine Fläche (`surface`/`card`/Rahmen). Alles innerhalb
   wird über Weißraum, Überschriften und Trennlinien (`border-t border-neutral-200`, `divide-y`) gegliedert,
   nicht über weitere umrandete/hinterlegte Kästen. Listen in Karten → `divide-y`-Listen statt Mini-Karten.
   Viele gleichartige Elemente (z. B. Termine, Downloads) lieber als Liste/Tabelle mit Linien statt Karten-Grid.
3. **Keine Deko-Effekte:** keine Blur-Blobs, `backdrop-blur`, Glas-Effekte, Verlaufsflächen
   (`bg-gradient-*`), `grid-overlay`, Glow-Schatten, Hover-Lift (`hover:-translate-y`) bei Karten.
4. **Keine Emoji-Icons in Kreisen** (IconCircle o. ä.) und keine dekorativen Icon-Kacheln. Icons nur, wo sie
   eine Funktion erklären (Button-Icons, Dateityp), schlicht als Strich-Icon in Textfarbe.
5. **Keine inflationären Eyebrow-Labels** (kleine VERSALIEN mit Sperrung über jeder Überschrift).
   Höchstens eins pro Seite, wenn es wirklich Information trägt.
6. Keine dekorativen Pfeile „→“ an jedem Link; nur bei echten Weiter-Links.

## Stattdessen

- Hierarchie über Typografie: h1/h2 in der Display-Schrift (`font-serif`), alles andere Textschrift.
  Pro Karte max. 3 Textgrößen. Textfarben: `text-neutral-900` (Fließtext), `text-neutral-700` (Meta),
  `text-brand-900` (Überschriften/Links), `text-[var(--color-dpsg-red)]` sparsam als Akzent.
- Gliederung über Linien und Weißraum (wie liniertes Papier): `border-t`, `divide-y`, großzügige Abstände.
- Ecken klein (`rounded-sm`/`rounded-md`), die Varianten-CSS setzt die Radien zentral.
- Buttons nur über `.btn-primary`, `.btn-secondary`, `.btn-danger` bzw. `Button.astro` – keine eigenen
  Button-Styles mit runden Ecken/Pills. Alle Buttons brauchen sichtbaren `:active`-Zustand (kommt aus CSS).
- Stufen kennzeichnen: kleiner Farbstrich/-punkt oder linke Randlinie in Stufenfarbe, Name als Text.

## Technik

- Funktion, Logik, Props, ARIA und Datenfluss nicht ändern – nur Markup/Klassen/Styles.
- Semantik behalten bzw. verbessern (Listen als `<ul>`, Tabellen als `<table>`, `aria-pressed` bei Filtern).
- Tailwind-Utilities mit vorhandenen Tokens verwenden; keine neuen Farben erfinden.
