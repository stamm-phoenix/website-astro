# Datenverbrauch messen (#175)

`web/scripts/measure-transfer.ts` misst, was die öffentlichen Seiten übertragen. Damit lassen sich die Maßnahmen aus #175 vorher und nachher vergleichen.

```bash
cd web
bun run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… bun scripts/measure-transfer.ts --serve dist --label nachher --out nachher.json
bun scripts/measure-transfer.ts --url https://www.stamm-phoenix.de --label live --out live.json
bun scripts/measure-transfer.ts --compare vorher.json nachher.json
```

## Was gemessen wird

- Seiten: Startseite, Gruppenstunden, Blogübersicht, der erste Beitrag der Übersicht und die Nikolausseite.
- Geräte: Pixel 7 (Handy) und ein Desktop-Fenster mit 1536 × 960.
- Je Seite ein frischer Browser ohne Cache („kalt“): erst nach dem Laden, dann nach dem Scrollen bis ans Ende, damit Bilder mit `loading="lazy"` mitzählen. Danach ein Neuladen mit dem Cache des ersten Besuchs („warm“).
- Bytes sind die Netzwerkbytes laut Browser (mit Headern, nach Komprimierung); aus dem Cache beantwortete Anfragen zählen 0. Dazu Requests, Aufteilung nach Typ, LCP und CLS. Ausgewiesen wird der Median aus `--runs` Läufen (Standard 3).
- `--serve <Ordner>` liefert einen Build lokal mit Brotli/gzip und den Cache-Headern aus `staticwebapp.config.json` aus. `/api/*` antwortet 404, die Seiten zeigen also ihre eingebackenen Inhalte. Die Commit-Angabe im Bericht ist der Stand des ausgelieferten Ordners.

## Grenzen

- Die lokale Messung nutzt die Testdaten (`CONTENT_SOURCE=mock`) und hat darum kaum Blogbilder, Leitendenfotos oder Instagram-Kacheln. Die Wirkung von WebP für hochgeladene Bilder (Blog, Leitende) und der Instagram-Karussells zeigt sie nicht. Das geht nur mit `--url` gegen eine Vorschau mit seeded Bildern oder die produktive Seite.
- Lokal gibt es weder Cloudflare noch Azure; Header und Kompression der Produktion prüft `curl -I -H 'Accept-Encoding: br' <URL>`.
- LCP und CLS sind auf einem schnellen Rechner ohne Drosselung gemessen und dienen nur dem Vergleich zweier Builds, nicht als Aussage über echte Geräte.

## Messung vom 28.10.2026: Hauptzweig gegen #448

Lokaler Build mit Testdaten, Median aus drei Läufen. Kalt = Bytes beim Laden plus Scrollen.

| Seite              | Gerät   |   Kalt vorher |  Kalt nachher |   Änderung |
| ------------------ | ------- | ------------: | ------------: | ---------: |
| `/`                | Handy   |      202,2 KB |      197,1 KB |     −2,5 % |
| `/gruppenstunden/` | Handy   |      234,5 KB |      232,2 KB |     −1,0 % |
| `/blog/`           | Handy   |      204,7 KB |      199,4 KB |     −2,6 % |
| `/blog/14/`        | Handy   |      179,4 KB |      177,1 KB |     −1,3 % |
| `/nikolaus/`       | Handy   |      253,0 KB |      250,8 KB |     −0,9 % |
| `/`                | Desktop |      230,5 KB |      225,4 KB |     −2,2 % |
| `/gruppenstunden/` | Desktop |      229,5 KB |      227,1 KB |     −1,0 % |
| `/blog/`           | Desktop |      199,6 KB |      194,3 KB |     −2,6 % |
| `/blog/14/`        | Desktop |      174,4 KB |      172,0 KB |     −1,4 % |
| `/nikolaus/`       | Desktop |      248,0 KB |      245,7 KB |     −0,9 % |
| **Summe**          |         | **2155,8 KB** | **2121,1 KB** | **−1,6 %** |

Warm sinkt jede Seite um 2,3 KB (die Lilie steckt im HTML). LCP (52–96 ms) und CLS ändern sich nicht über das Messrauschen hinaus.

### Was die Zahlen sagen

- Die Seiten sind klein: 170–250 KB kalt, davon etwa 45 KB Schrift und 45–97 KB Skripte. Hebel sind vor allem Bilder im echten Betrieb (Blog, Leitende, Instagram) und die Skripte der Nikolausseite (97 KB), nicht mehr die SVGs.
- Auffällig ist der Layoutsprung (CLS) auf dem Desktop: `/blog/14/` mit 0,44 und `/nikolaus/` mit 0,11, beides schon vor #448. Ein Wert über 0,1 gilt als schlecht und gehört in einen eigenen Fix.
