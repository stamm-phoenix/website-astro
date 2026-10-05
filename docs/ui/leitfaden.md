# Leitfaden für die Website

Der Entwurf aus PR #108 wird mit diesem Stand zum festen Design. Er verwendet die DPSG-Lilie links im Hintergrund, die Wort-Bild-Marke rechts im Kopf und den roten Unterstrich unter Seitentiteln. Phoenix bleibt mit dem eigenen Logo sichtbar. Es gibt keinen Variantenumschalter und keine Vorschauseite im Produkt.

## Gestaltungsplan

Die Grundpalette besteht aus DPSG-Blau `#003056`, Rot `#810a1a`, Beige `#ecdfcb`, Weiß `#ffffff`, Papier `#f8f5ef` und Text `#14202c`. Arvo trägt h1 und h2 sowie die Wortmarke. Source Sans 3 trägt Texte, Formulare und h3 bis h6. Fließtext bleibt möglichst unter 72 Zeichen je Zeile.

Die Ausrichtung ist linksbündig. Die Startseite behält den Phoenix neben ihrem Titel; Verwaltungsseiten beginnen mit Titel, Aufgabe und den benötigten Bedienelementen. Listen verwenden Trennlinien. Ein Dialog oder ein zusammengehöriger Bereich kann einen Rahmen erhalten, seine Unterbereiche brauchen keine zusätzlichen Karten.

```text
Phoenix + Wortmarke       Hauptlinks   Stamm & Hilfe   DPSG

Lilie   Seitentitel
        Aufgabe oder Einführung
        Filter und Aktionen
        Liste / Formular / Tabelle

        Kontakt und weitere Links
```

Der Vergleich mit dem Brief hat zwei Änderungen am Vorschlag ergeben. Die wiederholten Einblendanimationen entfallen, weil sie für die Bedienung nichts erklären. Rahmen bleiben dort, wo sie einen Bereich abgrenzen; verschachtelte Kästen in der Abrechnung werden durch Linien ersetzt. Die Lilie bleibt das wiedererkennbare grafische Element.

## Gemeinsame Bausteine

- `Button.astro` für statische Links und Buttons, `ui/ActionButton.svelte` für interaktive Buttons. Beide verwenden `.btn-primary`, `.btn-secondary` und `.btn-danger` aus `global.css`. Svelte-Buttons erhalten einen expliziten `type`, besonders in Formularen. Die Komponente reicht HTML-Attribute, Handler, `disabled` und `aria-busy` durch.
- `ui/FilterTabs.svelte` für Ansichten und Filter mit `aria-pressed`. Das ist eine Gruppe von Filterschaltern, keine ARIA-Tabliste. Echte Tabpanels wie in der Abrechnung behalten ihre Pfeiltastensteuerung.
- `ui/StatusLabel.svelte` für kurze Statusangaben, `pflege/StatusNotice.svelte` für Rückmeldungen als Live-Region.
- `pflege/FormField.svelte`, `.form-input` und `pflege/EditDialog.svelte` für Felder, Fehlerhinweise und Bearbeitungsdialoge. Ungültige Felder behalten den roten Rahmen auch im Fokus und im dunklen Theme.
- `ui/Panel.svelte` für Abschnitte in interaktiven Verwaltungsoberflächen, `Card.astro` und die gemeinsamen Klassen `.surface` und `.surface-muted` für zusammengehörige Bereiche. Kein Hover-Lift und keine verschachtelten Karten.

Neue Oberflächen sollen diese Bausteine verwenden. Eigene Buttonformen, feste weiße Oberflächen und eigene Statusfarbpaletten vermeiden. Fotos, Spinner und Kartenmarker dürfen rund bleiben.

## Farben und dunkles Theme

`global.css` enthält die gemeinsamen Tokens. `surface`, `neutral-*`, `brand-*`, `danger`, `success`, `warning`, `warning-soft`, `danger-soft`, `success-soft` und `focus` ändern sich mit `prefers-color-scheme`. `action` bleibt das dunkle DPSG-Blau für Buttons mit weißem Text. Die originalen DPSG-Farben bleiben für Marken und Stufenmarker erhalten.

Die automatische Auswahl funktioniert ohne JavaScript, folgt Änderungen der Systemeinstellung und bleibt nach Astro-Navigation erhalten. Externe CampFlow-Formulare und Karten können hell bleiben. Das Mitgliedsformular hat ausdrücklich `color-scheme: light` und einen weißen Hintergrund; Markenlogos erhalten im dunklen Theme eine helle Unterlage.

## Prüfung

Die bestehenden Ablaufprüfungen bleiben erhalten. `web/tests/theme.spec.ts` ergänzt helle und dunkle Präferenzen, deren Wechsel, Astro-Navigation, Navigation ohne JavaScript, Fehlermarkierungen und Druckzustände. Screenshots sollen öffentliche Seiten, Mitgliederansichten sowie Belege, Kalender, Abrechnung und Dialoge auf Desktop und Mobil einbeziehen.

Die Prüfung auf einem echten iPad in Safari bleibt eine manuelle Abnahme. Browseremulation kann einen echten Ausfall von Aktionen auf dem ursprünglich betroffenen Gerät nicht ausschließen.
