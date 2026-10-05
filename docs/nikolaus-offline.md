# Fahrtansicht bei Funklöchern

Vor der Fahrt in `/leitendenbereich/nikolaus-fahrt` den richtigen Tag und das eigene
Team wählen und **Route für Funklöcher speichern** drücken. Gespeichert wird genau
eine Teamroute mit den benötigten Familien- und Teamdaten, nicht die Routen aller
Teams. Dafür ein eigenes oder ein Teamgerät verwenden.

Die bereits geöffnete Seite bleibt bei Verbindungsverlust nutzbar. Beim Abhaken
erscheint „noch nicht bestätigt“. Solange diese Markierung aussteht, können
Disposition und Familien den neuen Stand noch nicht zuverlässig sehen.
Nach Wiederverbindung, beim erneuten Sichtbarwerden und beim regelmäßigen Refresh
wird die Warteschlange abgeglichen. **Jetzt abgleichen** startet das auch manuell.
Besuchszeiten kommen weiterhin vom Server und bezeichnen bei Offline-Markierungen
den Zeitpunkt des Abgleichs, nicht einen vom Handy gemeldeten Besuchszeitpunkt.

Die lokale Kopie kann einen erneuten Seitenaufruf überstehen, wenn das Seiten-HTML
und JavaScript erreichbar sind und die Anmeldung bestätigt werden kann; bei einem
Auth-Netzwerkfehler ist die Wiederherstellung nur im bereits angemeldeten Tab
möglich. Die Anwendung installiert keinen Service Worker. Ein vollständiger
Seitenneustart ohne Netz und Offline-Karten/Navigation werden nicht bereitgestellt:
**Die Seite während der Fahrt geöffnet lassen.**

## Konflikte und Wiederholungen

Jede Markierung besitzt eine zufällige Operation-ID und die Version des geladenen
Besuchs inklusive Routenzuordnung. Der Server speichert Operation-ID und Wirkung
zusammen im vorhandenen atomaren Dispo-Snapshot. Geht die Antwort verloren,
ändert eine Wiederholung desselben Vorgangs weder Zustand noch Besuchszeit erneut.
Eine andere inzwischen gespeicherte Markierung oder geänderte Planung führt zu
HTTP 409. Verlegte/stornierte/entfernte Buchungen werden ebenfalls geprüft.

Ein Konflikt bleibt sichtbar und wird nicht automatisch überschrieben. Den
aktuellen Stand prüfen, die lokale Markierung explizit verwerfen und den Besuch
gegebenenfalls neu markieren. „Verwerfen“ nimmt keine bereits auf dem Server
angekommene Änderung zurück. Für eine Rücknahme anschließend „Rückgängig“ nutzen.
Pro Besuch bleibt höchstens eine Markierung ausstehend; weitere Taps sind gesperrt.
Browser Locks koordinieren die gemeinsame Warteschlange zwischen Tabs.

## Lokale Lebensdauer und Löschen

Die Route und ihre Warteschlange werden in `localStorage` unter
`nikolaus-fahrt-offline-v1` gespeichert und der angemeldeten Nutzer-ID zugeordnet.
Es werden keine Login-Tokens oder Kennwörter gespeichert. Die Kopie läuft zwölf
Stunden nach dem ausdrücklichen Speichern ab; Refresh und Abgleich verlängern diese
Frist nicht. Abgelaufene Kopien werden nicht mehr angezeigt oder übertragen.

Ein Browser kann bei geschlossenen Seiten kein JavaScript ausführen. Physisches
Entfernen erfolgt daher beim nächsten Seitenaufruf (auch außerhalb der
Fahrtansicht), sowie während der geöffneten Fahrtansicht beim Refresh/Intervall.
**Lokale Route und Markierungen löschen** entfernt beides sofort; bei ausstehenden
Markierungen ist eine Bestätigung nötig. Auch der Abmelden-Link, ein erkannter
Nutzerwechsel und HTTP 401/403 entfernen die lokale Kopie. Bei einem gemeinsam
genutzten Gerät vor der Übergabe löschen und abmelden.

Nicht abgeglichene Markierungen gehen bei Ablauf oder ausdrücklichem Löschen
verloren. Der Serverstand bleibt davon unverändert. Vor Ablauf abgleichen oder
mit der Disposition den verbleibenden Stand klären. Browser ohne Web Locks können
die Onlineansicht benutzen; das lokale Speichern wird dort nicht angeboten.

Es sind keine neuen Azure-Ressourcen oder SharePoint-Listen erforderlich. API und
Frontend müssen gemeinsam veröffentlicht werden; alte Fahrt-Clients ohne
Operation-ID/Version werden aufgefordert, die Route neu zu laden.
