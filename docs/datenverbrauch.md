# Datenverbrauch messen (#175)

`web/scripts/measure-transfer.ts` misst, was die öffentlichen Seiten übertragen. Damit lassen sich die Maßnahmen aus #175 vorher und nachher vergleichen.

```bash
cd web
bun run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=… bun scripts/measure-transfer.ts --serve dist --blog /blog/14/ --label nachher --out nachher.json
bun scripts/measure-transfer.ts --url https://www.stamm-phoenix.de --label live --out live.json
bun scripts/measure-transfer.ts --compare vorher.json nachher.json
```

## Was gemessen wird

- Seiten: Startseite, Gruppenstunden, Blogübersicht, ein Beitrag und die Nikolausseite. Der Beitrag ist der erste der Blogübersicht; `--blog <Pfad>` legt ihn fest, damit zwei Berichte dieselbe Seite vergleichen. `--compare` nennt Seiten, die nur ein Bericht enthält, und lässt sie aus der Summe.
- Geräte: Pixel 7 (Handy) und ein Desktop-Fenster mit 1536 × 960.
- Je Seite ein frischer Browser ohne Cache („kalt“): Laden, dann Scrollen bis ans Ende, damit Bilder mit `loading="lazy"` mitzählen. Danach ein Neuladen mit dem Cache des ersten Besuchs („warm“).
- Bytes sind die Netzwerkbytes laut Browser (mit Headern, nach Komprimierung, Weiterleitungen eingeschlossen); aus dem Cache beantwortete Anfragen zählen 0. „Kalt“ ist die Summe aus Laden und Scrollen desselben Besuchs. Ausgewiesen wird jeweils der Median aus `--runs` Läufen (Standard 3), auch für die Kaltsumme.
- LCP ist der Wert des ersten Ladens. CLS ist das größte Fenster aufeinanderfolgender Layoutsprünge (höchstens 5 s lang, eine Pause von 1 s beendet es) des ersten Besuchs, also vor dem Neuladen.
- `--serve <Ordner>` liefert einen Build lokal mit Brotli/gzip aus. `Cache-Control` kommt von der ersten passenden Route der `staticwebapp.config.json` des Builds, ohne Treffer gibt es keinen Header. `/api/*` antwortet 404, die Seiten zeigen also ihre eingebackenen Inhalte.
- Der Commit im Bericht steht im Footer der Seiten (Build-Commit); so gehört er zu den gemessenen Dateien und nicht zum Checkout, in dem das Skript läuft.

## Grenzen

- Die lokale Messung nutzt die Testdaten (`CONTENT_SOURCE=mock`) und hat darum kaum Blogbilder, Leitendenfotos oder Instagram-Kacheln. Die Wirkung von WebP für hochgeladene Bilder (Blog, Leitende) und der Instagram-Karussells zeigt sie nicht. Das geht nur mit `--url` gegen eine Vorschau mit Testbildern oder die produktive Seite.
- Lokal gibt es weder Cloudflare noch Azure; Header und Kompression der Produktion prüft `curl -I -H 'Accept-Encoding: br' <URL>`.
- LCP schwankt lokal um bis zu 100 ms zwischen Läufen und Builds (Rechnerlast, ungedrosselt). Für den Vergleich taugen die Bytes, LCP nur als grober Hinweis. Auch CLS ist ungedrosselt gemessen.

## Messung vom 28.10.2026: vor und nach #448

Lokale Builds mit Testdaten, Median aus fünf Läufen. Vorher: `d8fd21f1`, nachher: Hauptzweig mit #448 (die Messung stammt aus einem Checkout, der sich nur durch Skript und Doku unterscheidet). Kalt = Laden plus Scrollen.

| Seite              | Gerät   |   Kalt vorher |  Kalt nachher |   Änderung |
| ------------------ | ------- | ------------: | ------------: | ---------: |
| `/`                | Handy   |      202,3 KB |      197,2 KB |     −2,5 % |
| `/gruppenstunden/` | Handy   |      234,5 KB |      232,2 KB |     −1,0 % |
| `/blog/`           | Handy   |      204,8 KB |      199,6 KB |     −2,5 % |
| `/blog/14/`        | Handy   |      179,4 KB |      177,1 KB |     −1,3 % |
| `/nikolaus/`       | Handy   |      253,0 KB |      250,8 KB |     −0,9 % |
| `/`                | Desktop |      230,6 KB |      225,6 KB |     −2,2 % |
| `/gruppenstunden/` | Desktop |      229,4 KB |      227,2 KB |     −1,0 % |
| `/blog/`           | Desktop |      199,7 KB |      194,5 KB |     −2,6 % |
| `/blog/14/`        | Desktop |      174,4 KB |      172,1 KB |     −1,3 % |
| `/nikolaus/`       | Desktop |      247,9 KB |      245,7 KB |     −0,9 % |
| **Summe**          |         | **2156,1 KB** | **2122,0 KB** | **−1,6 %** |

Warm sinkt jede Seite um 2,3 KB (die Lilie steckt im HTML). CLS ist vor und nach #448 gleich.

### Was die Zahlen sagen

- Die Seiten sind klein: 170–250 KB kalt, davon etwa 45 KB Schrift und 45–97 KB Skripte. Hebel sind vor allem Bilder im echten Betrieb (Blog, Leitende, Instagram) und die Skripte der Nikolausseite (97 KB), nicht mehr die SVGs.
- Auffällig ist der Layoutsprung (CLS) auf dem Desktop: `/blog/14/` mit 0,43 und `/nikolaus/` mit 0,09, beides schon vor #448. Ab 0,1 gilt ein Wert als nicht mehr gut; der Beitrag gehört in einen eigenen Fix.
