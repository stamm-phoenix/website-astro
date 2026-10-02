# Nikolaus-Planungen zuverlässig speichern

Dispo und Helfendeneinteilung speichern den vollständigen gewünschten Stand in jeweils einem SharePoint-Eintrag. Ein Datum der Dispo hat den Schlüssel `planning:dispo:YYYY-MM-DD`, die gesamte Einteilung den Schlüssel `planning:einteilung`. Die JSON-Daten haben das Format `{ "schema": 1, "rows": [...] }`.

## Liste und Einführung

Vor der Bereitstellung die gemeinsame Liste für `SHAREPOINT_NIKOLAUS_STATE_LIST_ID` einrichten. Sie benötigt die internen Spaltennamen `OperationKey` als einzeiligen Text mit Index und **erzwungenen eindeutigen Werten** sowie `State` als mehrzeiligen einfachen Text ohne Rich Text oder angehängte Änderungen. Die App benötigt Lesen, Erstellen, Ändern und Löschen. Die eindeutige Spalte verhindert, dass konkurrierende Erst-Speicherungen zwei Snapshots anlegen.

Die bisherigen Listen `SHAREPOINT_NIKOLAUS_DISPO_LIST_ID` und `SHAREPOINT_NIKOLAUS_EINTEILUNG_LIST_ID` bleiben als Migrationseingang erhalten. Solange ein Planungsschlüssel noch keinen Snapshot besitzt, liest die Anwendung die bisherigen Zeilen. Die erste Änderung übernimmt die Daten in einen atomaren Snapshot. Bei der Dispo bleiben vorhandene Besuchsmarkierungen erhalten, neue Besuche starten ohne Markierung. Die alte Liste wird bei dieser Übernahme nicht verändert.

Ab dem ersten Snapshot ist dieser der verbindliche Stand der betreffenden Planung. Das gilt auch für einen leeren Snapshot. Änderungen an alten SharePoint-Zeilen erscheinen danach nicht mehr in der Anwendung. Die alten Listen sind kein aktueller Export der Planung. Direktes Bearbeiten dieser Listen deshalb nach Einführung beenden. Zum Lesen des aktuellen Stands die Dispo-, Fahrt- oder Einteilungsansicht verwenden. Bei einer Bereinigung müssen sowohl alte Listenzeilen als auch Snapshots berücksichtigt werden, damit entfernte Snapshots keine alten Zeilen wieder sichtbar machen.

## Konflikte und Wiederholung

Die API prüft die vom Browser geladene Planungsversion innerhalb des bedingten Schreibvorgangs. SharePoint schreibt mit dem ETag des aktuellen Snapshots. Bei einer zwischenzeitlichen Änderung liest die API den Snapshot erneut und prüft die Planungsversion nochmals. Verschiedene konkurrierende Pläne erhalten einen Konflikt mit HTTP 409. Die Version der Dispo enthält die Planungsfelder; ein abgehakter Besuch verändert diese Version nicht. Besuchsmarkierungen verwenden denselben bedingten Schreibvorgang und bleiben bei einer gleichzeitigen Planungsänderung erhalten.

Ein fehlerhafter Speicherrequest hinterlässt entweder den bisherigen vollständigen Stand oder den neuen vollständigen Stand. Es gibt keine einzelnen Zeilenaufträge und keine nach einem Fehler weiterlaufenden Schreibworker. Wenn nur die Antwort nach dem erfolgreichen Schreiben verloren geht, erkennt ein identischer Wiederholungsrequest den bereits gespeicherten Stand und führt keinen weiteren Schreibvorgang aus.

Der Entwurf bleibt bei einem Speicherfehler im Browser erhalten. Erneut auf "Speichern" klicken, um denselben vollständigen Plan zu sichern. Erscheint ein Konflikt, den aktuellen Stand neu laden und die Änderungen dort erneut bearbeiten. Das Neuladen verwirft den Entwurf nach der bereits vorhandenen Bestätigung. Ohne Neuladen oder erneutes Speichern ist der Stand nach einem Verbindungsabbruch nicht bestätigt.

## Wiederherstellung beschädigter Daten

Ungültige Snapshotdaten lösen einen Fehler aus. Die Anwendung ersetzt sie nicht durch einen leeren Plan oder alte Zeilen. Zur Wiederherstellung den Nikolausdienst für die Wartung sperren, den betroffenen Snapshot samt ETag sichern und den vollständigen korrekten JSON-Stand mit bedingtem Update wiederherstellen. Ein SharePoint-412 bedeutet, dass der Zustand inzwischen geändert wurde. Dann erneut lesen und prüfen, bevor geschrieben wird. Einen Snapshot nur nach bewusstem Abgleich mit den alten Listen löschen, da dessen Löschung den Migrationseingang wieder aktiviert.

## Nachweis ohne Produktionsdaten

`bun run build` in `api/`, anschließend `node --test dist/test/nikolaus-planning-save.test.js`. Die SharePoint-Simulation erzwingt eindeutige Planungsschlüssel und ETags. Sie prüft konkurrierende Erst-Speicherungen, Fehler vor und nach dem Commit, identische Wiederholungen, Migration, leere Pläne, gleichzeitige Besuchsmarkierungen und Änderungen der Helfendeneinteilung. Die Tests lesen oder schreiben keine echten Listen.
