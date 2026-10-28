# Startdaten der Essensplanung

Ausgangsdaten für das Modul [Essensplanung](../../../../docs/essensplanung.md) ([#452](https://github.com/stamm-phoenix/website-astro/issues/452)). Sie stammen aus dem Google Sheet „2026 – Küche Bezirkslager“, Stand Oktober 2026. Die Datei selbst liegt nicht im Repo.

Die Dateien sind **noch keine Migration**. Die Migration `essen` (PR 2) liest sie und legt daraus die zentralen Listen an. Bis dahin ändert sie niemand von Hand. Danach gilt die Datenbank, und Änderungen laufen über die Steuerung.

`db-migrations.ts` liest nur Dateien `NNNN_name.sql` direkt in `api/migrations`, dieser Ordner wird also nicht als Migration ausgeführt.

Alle Dateien sind UTF-8, durch Kommas getrennt, mit Kopfzeile.

| Datei | Inhalt |
| --- | --- |
| `zutaten.csv` | Zentrale Zutatenliste: 395 Lebensmittel und 38 Nicht-Lebensmittel (Blatt `Bestandsdaten`, Spalten „Zutat“ und „Sonstiges“). Doppelte Namen (Kopfsalat, Ausstechform, Sonnencreme, Sonnencreme (sprüh)) gibt es nur einmal, die Lebensmittel-Zeile gewinnt. |
| `kategorien.csv` | 28 Kategorien (Blatt `Bestandsdaten`, „Kategorieliste Supermarkt“) |
| `gruppen_vorlage.csv` | Gruppen mit Faktor für neue Planungen: Wö 0,7, Jupfi 0,8, Pfadi 1, Rover 1,2, Leitende 1,2 („Leiter“ im Sheet) |
| `mahlzeiten_vorlage.csv` | Standard-Mahlzeiten für neue Tage. Nicht aus dem Sheet, sondern aus der Anforderung in #452. |
| `umrechnung_loeffel.csv` | Gramm pro TL und EL je Zutat (Blatt `Umrechnungstabelle`, zwei Tabellen, Spalte `tabelle`) |
| `stueckgewichte.csv` | Gewicht pro Stück, Bund, Tüte … (Blatt `Umrechnungstabelle`: „Durchschnittliche Gewichte“ mit essbarem Anteil und „Mittleres Gewicht“ für Obst und Gemüse) |
| `metro_artikel.csv` | Metro-Artikel, die für das Bezirkslager bestellt wurden, mit Packung und Preis (Blatt `metro_warenkorb`, ohne bestellte Mengen). Es gibt keine Zuordnung zu Zutaten. Gedacht für die Ausbaustufen Packungsgrößen und Budget. Preise in Euro mit Komma, wie im Sheet. |

## `zutaten.csv`

| Spalte | Bedeutung |
| --- | --- |
| `name` | Name, eindeutig |
| `kategorie` | Name aus `kategorien.csv` |
| `einheitenart` | `masse` (g/kg), `volumen` (ml/l), `stueck`, `packung` oder `bund` |
| `abtropfgewicht` | `true`, wenn das Sheet „g (ATG)“ führt (Dosen, Gläser). Angezeigt als „kg (ATG)“. |
| `lebensmittel` | `false` für Nicht-Lebensmittel (Spülmittel, Alufolie …). Die dürfen nicht in Gerichte, nur in Zusatzbedarf und Bestand. |
| `einheit_sheet` | Originale Einheit im Sheet, nur zur Nachvollziehbarkeit |
| `verwendungen_sheet` | In wie vielen Zutatenzeilen der Tagesblätter die Zutat vorkam |
| `davon_mit_allem`, `davon_vegetarisch`, `davon_vegan` | In wie vielen dieser Zeilen die Ernährungsform angehakt war |

Die Merkmale vegan, vegetarisch und Allergene stehen nicht im Sheet. PR 2 schlägt sie vor und lässt sie in der Steuerung prüfen:

- War eine Zutat nie für vegetarisch angehakt (`davon_vegetarisch = 0` bei `verwendungen_sheet > 0`), ist sie wohl nicht vegetarisch (Hackfleisch).
- War sie für vegan angehakt, ist sie wohl vegan.
- Ungenutzte Zutaten und die Allergene schlägt die KI vor.

Das Geschäft aus dem Sheet (fast immer Metro) wird **nicht** übernommen, weil es Geschäfte nur pro Planung gibt.

Die Namen in `umrechnung_loeffel.csv` und `stueckgewichte.csv` (`zutat_text`) passen nicht immer zu `zutaten.csv` (z. B. „Apfel“ und „Äpfel“). Die Zuordnung macht PR 2 bzw. PR 4.
