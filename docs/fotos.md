# Fotos

Das Modul „Fotos“ (`/leitendenbereich/fotos`) zeigt die Foto-Ablage der Leitenden in SharePoint
und lädt neue Fotos und Videos dorthin hoch. Die Ablage ist die Dokumentbibliothek
`https://stammphoenix.sharepoint.com/sites/leitende/Fotos` (`CONFIG.fotos.library`). Außer dieser
Bibliothek gibt es keine Speicherung: keine Tabelle in Azure SQL, kein Blob Storage, nichts im
Browser.

## Ordnerstruktur

An der Wurzel liegen `Aktionen` und `Gruppenstunden`. Für Aktionen gewünscht ist
`Aktionen/<Jahr>/<Aktion>/<Vorname>`, z. B. `Aktionen/2025/Schwedenfahrt 2025/Nico`
(`FOTO_AKTIONEN_FOLDER` in `api/lib/foto-pfade.ts`). Die Bibliothek weicht an vielen Stellen davon
ab; das Modul zeigt sie so, wie sie ist. Ordner und Dateien stehen auf jeder Ebene alphabetisch
(deutsch sortiert, Zahlen nach ihrem Wert, also `2` vor `10`), ohne Sonderfälle. Ordnernamen,
die SharePoint erlaubt (auch mit doppelten Leerzeichen oder sehr lang), lassen sich öffnen. Die
Struktur wird nur beim Hochladen für eine Aktion verwendet:

- Die Aktion kommt aus CampFlow und aus dem Kalender der Website (Einträge ohne CampFlow).
  Angeboten werden zuerst die Aktionen der letzten vier Monate, alle anderen über die Suche oder
  „Alle Aktionen anzeigen“.
- Das Jahr ist das des Beginns, der Vorname der der angemeldeten Person (aus dem Login, nicht
  änderbar). Fehlende Ordner legt die API an; bestehende werden unabhängig von Groß- und
  Kleinschreibung wiederverwendet. Zeichen, die SharePoint nicht erlaubt, werden durch Leerzeichen
  ersetzt (`api/lib/foto-pfade.ts`, auch im Frontend verwendet).
- Mit „Ordner selbst wählen“ (oder „Hierher hochladen“ in einem Ordner) geht der Upload in einen
  beliebigen Ordner, optional in einen neuen Unterordner, z. B. für Fotos einer anderen Person.
  Ist der letzte Upload fertig, öffnet „Hierher hochladen“ ein neues Formular mit diesem Ziel.

Jeder Ordner hat eine eigene Adresse: Die Seite hält den offenen Ordner im Hash
(`/leitendenbereich/fotos#pfad=Aktionen%2F2026`, `web/src/lib/fotoAnsicht.ts`), und „Link
kopieren“ kopiert genau diesen Link (`fotoOrdnerLink` in `api/lib/foto-pfade.ts`, auch für die
Benachrichtigung verwendet). Der Hash erreicht den Server nie; muss man sich erst anmelden, ist
nicht geprüft, ob er den Umweg über die Anmeldung von Static Web Apps übersteht (wie bei den
Links der Protokoll-Mails, `#protokoll-<id>`).

Umbenennen, Verschieben und Löschen gibt es im Modul bewusst nicht; dafür führt „In SharePoint
öffnen“ zum Ordner bzw. zur Datei.

## Ansehen und Herunterladen

`GET /api/intern/fotos/ordner?pfad=` liefert Ordner und Dateien mit Vorschaubildern und
Download-Links von SharePoint. Diese Links gelten etwa eine Stunde ohne SharePoint-Login; der
Browser lädt Vorschauen und Dateien direkt von `stammphoenix.sharepoint.com` bzw. Microsofts
Vorschaudienst (`*.svc.ms`), beides ist in der CSP erlaubt. Das Frontend lädt einen Ordner nach
30 Minuten neu. `GET /api/intern/fotos/dateien/{id}` liefert für die Großansicht eine Version bis
1920 Pixel, einen frischen Download-Link und für Videos den Player von SharePoint.

Videos spielt der Browser selbst ab, direkt vom Download-Link (`media-src` in der CSP); so reicht
ein Tipp, und Teilen-Schaltflächen von SharePoint erscheinen nicht. Kann der Browser das Format
nicht abspielen (z. B. MTS, AVI, HEVC in manchen Browsern), bietet die Großansicht den Player von
SharePoint an. Eine einzelne Datei wird im Hintergrund geholt und gespeichert (bis 300 MB, darüber
über einen versteckten Frame), damit die Seite und ein laufendes Video bleiben.

Mehrere Dateien werden im Browser zu einem ZIP gepackt (ohne Kompression, `web/src/lib/fotoZip.ts`).
Weil Handys das Archiv im Speicher halten, ist eine Auswahl auf 1 GB begrenzt; größere Mengen
lädt man in SharePoint herunter. Eine einzelne Datei wird ohne Archiv direkt gespeichert, auch
über 1 GB. Scheitert eine Datei endgültig, bricht der ganze Download ab.

## Hochladen

1. `POST /api/intern/fotos/ziel` legt den Zielordner an und gibt den Pfad zurück.
2. Pro Datei `POST /api/intern/fotos/upload` mit Name und Größe. Liegt im Ordner schon eine Datei
   mit gleichem Namen und gleicher Größe, wird sie übersprungen („war schon da“). Sonst erstellt
   die API eine Upload-Session von SharePoint. Ist der Name durch eine andere Datei belegt,
   wählt die API den nächsten freien Namen (`IMG (1).jpg`), den der Browser für einen Neustart
   behält; so entsteht auch nach einer verlorenen Antwort keine zweite Kopie, und überschrieben
   wird nie etwas.
3. Der Browser schickt die Datei in Teilen von 5 MB direkt an die Upload-URL von SharePoint, drei
   Dateien gleichzeitig (`web/src/lib/fotoUpload.svelte.ts`).

Nach der Auswahl zeigt das Formular kleine Vorschaubilder (für HEIC und RAW den Dateinamen), aus
denen man einzelne Dateien wieder entfernen kann. Der Button „Hochladen“ steht in einer festen
Leiste unten, und die Liste der Aktionen klappt nach der Wahl zu. Die gewählten Dateien bleiben beim Wechsel zu „Fotos ansehen“ und nach einem Fehler beim
Anlegen des Ordners („Ziel ändern“) erhalten, bis man neue auswählt oder die Seite verlässt.

## Leitende benachrichtigen

Ist ein Upload fertig (oder abgebrochen) und ist mindestens eine Datei neu angekommen, bietet der
Fortschritt „Leitende benachrichtigen“ an. Die Empfängerauswahl ist die des Protokollversands
(`ProtokollEmpfaenger.svelte`): die aktuellen Mitglieder der CampFlow-Gruppen in
`CONFIG.fotos.campflowGroups` (Leiter*innen) und mit den Labels in `CONFIG.fotos.campflowLabels`
(„Protokollempfang“). Einzelne Personen lassen sich herausnehmen. Das Feld für weitere Adressen
ist die Personensuche (`ui/PersonSuche.svelte`) und bietet die Personen des Moduls „Personen“ an:
die Leitenden der Entra-Gruppe und die aktiven Altleitenden und Weiteren, jeweils mit der
primären Adresse ihrer verknüpften CampFlow-Person, sonst mit ihrem Login (`fotoPersonen`).
Jede andere Adresse lässt sich weiter von Hand eintragen.

`POST /api/intern/fotos/benachrichtigung` mit `action: 'preview'` liefert die Liste, ihre
Version und die Personen zum Hinzufügen (`personen`), mit `action: 'send'` (`pfad`, `dateien`,
`version`, `excluded`, `extra`) geht eine Mail in Blindkopie von `CONFIG.fotos.sender` (`api/lib/foto-benachrichtigung.ts`). Gezählt und gezeigt
werden nur Dateien, die wirklich im Ordner liegen. Die Mail nennt Vorname, Anzahl und Ordner
(„Nico hat 12 neue Fotos in den Ordner „Sola / Nico“ hochgeladen“), zeigt bis zu sechs
quadratische Vorschaubilder von SharePoint (240 Pixel, als eingebettete Anhänge mit `cid:`) und
verlinkt den Ordner im Leitendenbereich. Antworten gehen an die hochladende Person. Fehlt für
eine Datei noch eine Vorschau, fehlt sie in der Mail. Welche Dateien schon gemeldet wurden, merkt
sich nur die offene Seite; nach „Fehlgeschlagene erneut versuchen“ lässt sich für die neu
angekommenen noch einmal benachrichtigen.

Ausfallsicherheit: Ohne Verbindung wartet der Upload, bis das Gerät wieder online ist, und fragt
SharePoint dann, ab welchem Byte es weitergeht. Fehler von SharePoint werden mit wachsendem
Abstand wiederholt. Ist die Session abgelaufen oder die Antwort auf den letzten Teil verloren
gegangen, startet die Datei neu; die Prüfung aus Schritt 2 erkennt dabei eine schon vollständig
angekommene Datei. Läuft die Anmeldung ab, hält der Upload an, bis man sich in einem neuen Tab
wieder angemeldet hat. Während des Uploads bleibt der Bildschirm an (Wake Lock), und die Seite
warnt vor dem Verlassen. Wer den Tab schließt, bricht ab; fertige Dateien bleiben in der Ablage.

Fotos und Videos werden an der Dateiendung erkannt: JPEG, PNG, HEIC/HEIF, WebP, die RAW-Formate
der gängigen Kamerahersteller sowie MP4, MOV, MKV, AVI, MTS und weitere. Andere Dateien lehnt
die API ab.

## Voraussetzungen und Vorschauumgebungen

Die App-Registrierung der API braucht Schreibrechte auf die Site (wie für die Protokolle). Hat die
Bibliothek Pflichtspalten oder verlangt sie Auschecken, bleiben hochgeladene Dateien ausgecheckt;
die Bibliothek muss daher ohne beides eingerichtet sein. PR-Vorschauen verwenden dieselbe echte
Bibliothek. Lokal (`bun run dev:mock`) gibt es eine Ablage im Speicher
(`web/dev/mock-data/fotos.ts`); Dateien mit „wackel“ im Namen bekommen dort einmal einen
Serverfehler, um die Wiederaufnahme zu zeigen.
