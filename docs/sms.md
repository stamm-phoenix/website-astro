# SMS

Die Website verschickt SMS über **Azure Communication Services** (ACS), bezahlt aus dem
Nonprofit-Guthaben des Azure-Abos. Code: `api/lib/sms.ts`.

## Wer bekommt welche SMS?

| Anlass                                    | Empfänger                                                            | Code                     |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| Beleg eingereicht oder erneut eingereicht | Team „Kasse“ (`team-kasse`) ohne die Person, die ihn eingereicht hat | `api/lib/beleg-kasse.ts` |

Die SMS geht zusätzlich zur Mail an die Kasse, nicht statt ihr. Der Text hat höchstens 160
Zeichen im GSM-Alphabet (eine SMS); Geschäft und Name werden notfalls gekürzt, der Link bleibt
immer ganz.

## Woher kommt die Nummer?

**Microsoft-Konto → Modul „Personen“ → CampFlow-Mitgliederliste**:

1. Die Mitglieder der Entra-Gruppe des Teams (`CONFIG.staff.teams.kasse.groupId`).
2. Ihre Verknüpfung mit einer CampFlow-Person in `organisation.person` (`docs/personen.md`).
3. In CampFlow die erste Nummer unter `phone_numbers`, die eine deutsche Handynummer ist
   (`015…`, `016…`, `017…`, auch als `+49 …` oder `0049 …`), in E.164 umgeschrieben.

Wer nicht verknüpft ist, in CampFlow keine deutsche Handynummer hat oder dessen Person CampFlow
gerade nicht liefert, bekommt keine SMS. Gleiche Nummern bekommen nur eine SMS. Die Nummern
werden nirgends gespeichert und verlassen den Server nur zu ACS.

## Zeit und Fehler

Die Benachrichtigung läuft im Request, der den Beleg speichert, und bleibt in dessen Zeitbudget
(40 Sekunden, `REQUEST_BUDGET_MS`): CampFlow-Abfragen, die zu lange dauern, fallen weg, der
Versand selbst hat höchstens zehn Sekunden und keine Wiederholung. Ein Fehler wird nur geloggt
(`[belege] SMS an die Kasse …`) und hält das Einreichen nie auf. PR-Previews verschicken nichts.

## Einrichtung

Eingerichtet am 10.11.2026: Ressource `website-astro-sms` (Ressourcengruppe `website-astro`,
Datenstandort Europa), eigene Rolle „Website SMS Sender“ (nur `read`/`write` auf
`Microsoft.Communication/CommunicationServices`) für die App-Registrierung `website-astro` auf
der Ressource, Absender `DPSGPhoenix`.

Ohne `CONFIG.sms` (`api/lib/config.ts`) wird keine SMS verschickt; der Rest läuft wie bisher.

1. Im Abo eine **Communication Services**-Ressource anlegen, Datenstandort Europa.
2. **Alphanumerische Absenderkennung** aktivieren (Blade „Alphanumeric Sender ID“). Es gibt
   keine Antworten auf die SMS, eine Telefonnummer braucht es daher nicht. Ist der Button
   ausgegraut, ein Support-Ticket öffnen: Ob ein Abo mit Nonprofit-Guthaben zugelassen wird,
   entscheidet Microsoft im Einzelfall.
3. Der App-Registrierung der API (`CONFIG.azure.clientId`) eine Rolle auf der Ressource geben,
   mit der sie SMS senden darf. Die API meldet sich mit ihrem Zertifikat an
   (`AZURE_CLIENT_CERT`, Scope `https://communication.azure.com/.default`); es gibt keinen
   Zugriffsschlüssel und kein neues Secret.
4. `CONFIG.sms` setzen: `endpoint` (`https://<name>.<region>.communication.azure.com`) und
   `sender` (höchstens elf Buchstaben und Ziffern, z. B. `StammPhnx`).

Für den Umzug in die Container App (#528) ändert sich nichts: kein Eintrag in
`staticwebapp.config.json`.
