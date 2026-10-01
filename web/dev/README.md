# Lokale Demo-Daten

`bun run dev:mock` lädt die Middleware nur im Astro-Devserver. Sie beantwortet alle
`/api/*`- und `/.auth/*`-Anfragen lokal. Unbekannte API-Pfade liefern 404, statt an
einen echten Dienst weitergeleitet zu werden. Das Mitgliedsformular nutzt einen
lokalen Embed-Ersatz, dessen Eingaben nicht versendet werden. Schreiben ändert nur
den Arbeitsspeicher dieses Prozesses. Ein Neustart setzt die Daten zurück.

Das feste Demodatum ist der 1. Oktober 2026. Die Browserprüfungen verwenden dasselbe
Datum, während ihre Timer normal weiterlaufen. Demo-Login und Beispieladressen
gewähren keine Berechtigung in Azure oder SharePoint.

Die Mock-Dateien stammen aus PR #108. Aus der Browserprüfung in PR #103 wurden die
Ideen für simulierte Antworten und Prüfungen bei schmalen Viewports übernommen.
Die Zahlungsfunktion aus diesem PR gehört nicht zur Demo oder Testsuite.

Die Middleware ist vereinfacht. Beispielsweise simuliert sie keine konkurrierende
Kapazitätsreservierung oder Erkennung doppelter Nikolausbuchungen. Pflege-Endpunkte
prüfen ETags nicht durchgehend. Die Sammelbestellungs-Endpunkte prüfen ETags, damit
Browserprüfungen echte 409-Antworten und das Erhalten ungespeicherter Eingaben testen
können. Die API-Tests prüfen die tatsächlichen Buchungs- und Speicherregeln.

Die Playwright-Suite blockiert sämtliche externen HTTP-Anfragen, prüft beide
Viewportgrößen und schlägt bei nicht abgefangenen Browserfehlern fehl. Sie testet
die lokale Einbindung des Mitgliedsantrags, nicht den Code des externen Anbieters.
