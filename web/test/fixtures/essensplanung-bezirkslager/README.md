# Testdaten: Küche Bezirkslager 2026

Ein echtes Lager mit 10 Tagen und bis zu 237 Teilnehmenden, aus dem Google Sheet „2026 – Küche Bezirkslager“. Gedacht für die Tests der Berechnung (`web/src/lib/essensplanung/rechnung.ts`, PR 5 von [#452](https://github.com/stamm-phoenix/website-astro/issues/452)). Die Spalten mit `_sheet` sind die Werte, die das Sheet berechnet hat. Die Rohdaten sind unverändert, auch Tippfehler wie die Rezeptmenge `s` bei Frittierfett in `3_4`.

| Datei | Inhalt |
| --- | --- |
| `tagesplan.csv` | Eine Zeile je Mahlzeit (`mahlzeit_id` wie `3_1`). Die Spalten `<ernährung>_<gruppe>` sind die Anwesenden dieser Mahlzeit, ungewichtet. Dazu die gewichteten Summen des Sheets. |
| `gruppenfaktoren.csv` | Faktoren der Gruppen, wie im Sheet benannt |
| `gericht_zutaten.csv` | 683 Zutatenzeilen: Gericht der Mahlzeit, Referenz-Personenzahl, Gerichtsfaktor, Rezeptmenge, Häkchen je Ernährungsform, feste Gesamtmenge („override“), Gesamtmenge, Einkaufsmenge und Einheit, Geschäft und Kategorie |
| `notizen.csv` | Einträge, die im Sheet in der Zutatenspalte standen, aber Notizen sind, z. B. „Allergene: 2x Gluten, 1x Weizen, 13x Laktose“. Sie zeigen, dass Unverträglichkeiten bisher nur als Freitext mitliefen. |
| `bestand.csv` | Anfangsbestand im Lager des Bezirks |
| `zusaetzlich.csv` | Zusätzlich eingekaufte Dinge ohne Gericht (Spülmittel, Müllbeutel, Gummibärchen …) |

## So rechnet das Sheet

Die folgende Rechnung bildet alle 683 Zeilen von `gericht_zutaten.csv` exakt ab (Abweichung < 0,01):

```
Esser  = Σ Anwesende(mahlzeit, ernährung, gruppe) × Faktor(gruppe)
         über alle Ernährungsformen, die bei der Zutat angehakt sind
Gesamt = feste_gesamtmenge,                                        falls gesetzt
         rezeptmenge ÷ referenz_personen × Esser × gerichtsfaktor, sonst
```

`einkaufsmenge_sheet` ist `gesamt_sheet` in kg bzw. L. Stück werden **pro Gericht** aufgerundet, z. B. Zucchini 7,2 → 8. Die Essensplanung rundet erst die Summe auf der Einkaufsliste auf; das ist in #452 entschieden.
