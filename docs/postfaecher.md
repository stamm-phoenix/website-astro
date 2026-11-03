# E-Mail (Gruppenpostfächer)

Der Bereich „E-Mail“ im Leitendenbereich zeigt Gruppenpostfächer des Stammes:

| Postfach                    | Seite                              | sehen dürfen    |
| --------------------------- | ---------------------------------- | --------------- |
| `kontakt@stamm-phoenix.de`  | `/leitendenbereich/email/kontakt`  | `team-leitende` |
| `vorstand@stamm-phoenix.de` | `/leitendenbereich/email/vorstand` | `team-vorstand` |
| `verein@stamm-phoenix.de`   | `/leitendenbereich/email/verein`   | `team-verein`   |
| `admin@stamm-phoenix.de`    | `/leitendenbereich/email/admin`    | `team-admin`    |

Der Leitendenbereich selbst bleibt dem Team „Leitende“ vorbehalten: Wer nur in `team-verein` ist,
kommt nicht hinein und sieht das Postfach dort nicht. Jedes Postfach hat eine eigene Seite
(`/leitendenbereich/email/<id>`) und eine Kachel im Abschnitt „E-Mail“. Wie beim Modul „Fotos“
wird Outlook nicht nachgebaut: Gelesen, Zuständigkeit und Anhänge gibt es hier, Antworten,
Verschieben, Löschen und alles Weitere in Outlook („In Outlook öffnen“).

## Was das Modul kann

- **Liste:** Die neuesten 100 Nachrichten des Posteingangs (`INBOX_LIMIT`), nach Konversation
  (`conversationId` von Exchange) gruppiert, neueste zuerst. Filter: Alle, Ungelesen, Mir
  zugewiesen, Ohne Zuständige. Wer eine Konversation in Outlook aus dem Posteingang verschiebt
  (z. B. archiviert), nimmt sie damit aus der Liste.
- **Lesen:** Alle Nachrichten der Konversation aus allen Ordnern, also auch Antworten aus
  „Gesendete Elemente“. HTML wird in einem abgeschotteten Rahmen gezeigt (`MailInhalt.svelte`):
  `sandbox` ohne Skripte und Formulare, eine eigene CSP ohne Netzwerkzugriff. Bilder aus dem
  Internet (oft Zählpixel) laden erst nach „Bilder anzeigen“; eingebettete Bilder (`cid:`) bettet
  die API als `data:`-URL ein (bis 1 MB je Bild, 4 MB je Nachricht). Anhänge bis 25 MB lädt die
  API herunter, immer als Download und nur PNG, JPEG, GIF, WebP und PDF mit ihrem Typ; angehängte
  Nachrichten und größere Dateien gibt es nur in Outlook.
- **Gelesen pro Person:** Öffnen markiert die ungelesenen Nachrichten nur für die angemeldete
  Person als gelesen (`postfach.gelesen`). Der Gelesen-Status in Outlook ändert sich nicht, weil
  die API das Postfach nur liest. Beim ersten Besuch gilt alles, was älter als
  `CONFIG.postfaecher.ungelesenTage` (14 Tage) ist, als gelesen (`postfach.leser.gelesen_bis`);
  „Alle als gelesen markieren“ setzt diese Grenze auf jetzt. „Als ungelesen markieren“ setzt eine
  Markierung, die auch vor der Grenze gilt. „Alle als gelesen“ löscht die Markierungen dieser
  Person in diesem Postfach; die der anderen bleiben unberührt.
- **Zuständigkeit:** pro Konversation eine Person (`postfach.zustaendigkeit`). „Ich kümmere mich“
  oder „Jemandem zuweisen“ (Mitglieder der Teams des Postfachs, aus Entra ID). Die Seite schickt
  mit, wen sie als zuständig angezeigt hat; hat das inzwischen jemand geändert, kommt
  `409` mit dem aktuellen Namen und nichts wird gespeichert.
- **Benachrichtigung:** Wer von jemand anderem zuständig gemacht wird, bekommt eine Mail an das
  eigene Konto (`postfach-mails.ts`, gesendet vom Postfach selbst, ohne Kopie in seinen „Gesendeten Elementen“, damit Betreffe des Vorstands-Postfachs nicht im Kontakt-Postfach landen) mit Betreff, Absender
  und einem Link auf die Konversation (`#konversation=<id>`), ohne den Text der E-Mail. Scheitert
  der Versand, bleibt die Zuständigkeit gespeichert und die Seite sagt, dass man selbst Bescheid
  geben soll. PR-Previews schicken keine solchen Mails, weil sie den Mailversand der Produktion
  teilen.
- **Startseite:** Der Kasten „E-Mails“ zeigt Konversationen mit ungelesenen Nachrichten oder die
  der Person zugewiesen sind, aus allen Postfächern, die sie sieht (`GET /api/intern/postfach`).

## Wer welches Postfach sieht

Microsoft Graph kann die Berechtigungen eines Postfachs (Vollzugriff, Senden als) nicht lesen;
das geht nur über Exchange Online PowerShell. Deshalb steht in `api/lib/postfach-liste.ts` für
jedes Postfach, welche Teams (`CONFIG.staff.teams`) es sehen. Die Seite prüft das über die Rollen
(`roles` der Kachel), die API in jedem Aufruf. Die Liste sollte zu den Berechtigungen in Exchange
passen: Wer das Postfach hier sieht, aber in Exchange keinen Vollzugriff hat, kann „In Outlook
öffnen“ nicht nutzen.

Ein weiteres Postfach:

1. Eintrag in `POSTFAECHER` (`api/lib/postfach-liste.ts`): `id` (Teil der Adresse und der
   gespeicherten Zeilen, nie ändern), Name, Adresse, Beschreibung, Teams. Fehlt ein Team, erst in
   `CONFIG.staff.teams` eintragen ([berechtigungen.md](berechtigungen.md)).
2. Der App den Lesezugriff auf das Postfach geben (unten, Schritt 2).
3. Seite, Kachel und Startseite kommen von selbst.

## Einrichtung in Azure und Exchange

Die API liest mit ihrer App-Registrierung (`CONFIG.azure.clientId`). Dafür braucht sie
**einmalig**:

1. **Graph-Anwendungsberechtigung `Mail.Read`** mit Administratorzustimmung (Entra ID →
   App-Registrierungen → website-astro → API-Berechtigungen). Ohne sie antwortet jede Seite mit
   „Die Website darf dieses Postfach gerade nicht lesen …“ (`503 POSTFACH_GESPERRT`, im Log
   `[postfach] Graph verweigert …`).
2. **Auf die Gruppenpostfächer beschränken.** `Mail.Read` gilt sonst für alle Postfächer des
   Tenants. Mit RBAC for Applications in Exchange Online (Exchange Online PowerShell):

   ```powershell
   New-ServicePrincipal -AppId 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 -ObjectId 50f52211-4d8f-4bfb-9ce1-897649d8c1f9 -DisplayName website-astro
   New-ManagementScope -Name "Website Gruppenpostfaecher" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'kontakt@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'vorstand@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'verein@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'admin@stamm-phoenix.de'"
   New-ManagementRoleAssignment -App 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 -Role "Application Mail.Read" -CustomResourceScope "Website Gruppenpostfaecher"
   ```

   Danach die tenantweite Graph-Berechtigung `Mail.Read` aus Schritt 1 wieder entfernen, sonst
   gilt sie weiter für alle Postfächer; die Exchange-Rolle reicht. Für ein weiteres Postfach den
   Filter des Scopes erweitern. Prüfen mit
   `Test-ServicePrincipalAuthorization -Identity 5dd5864b-… -Resource kontakt@stamm-phoenix.de`.

3. `Mail.Send` (für die Benachrichtigung) und `GroupMember.Read.All`/`User.Read.All` (für die
   Personenliste) hat die App schon.

## Technik

- **IDs:** Alle Abfragen schicken `Prefer: IdType="ImmutableId"`, damit eine Nachricht ihre ID
  behält, wenn jemand sie in Outlook verschiebt. Outlook im Web braucht die REST-ID; die API
  übersetzt sie für „In Outlook öffnen“ mit `translateExchangeIds`
  (`https://outlook.office.com/mail/<postfach>/inbox/id/<rest-id>`). Klappt das nicht, öffnet der
  Knopf das Postfach.
- **Zwischenspeicher:** Der Posteingang wird je Function-Instanz höchstens alle 30 Sekunden
  gelesen, „Neu laden“ umgeht das; die Personenliste fünf Minuten.
- **Routen** (`api/endpoints/intern-postfach.ts`, alle hinter `requireStaff`):
  `GET /api/intern/postfach`, `GET …/{postfach}`, `GET …/{postfach}/konversation?id=`,
  `POST …/{postfach}/gelesen`, `GET …/{postfach}/personen`, `PUT …/{postfach}/zustaendig`,
  `GET …/{postfach}/anhang?nachricht=&anhang=`.
- **Daten:** Schema `postfach` (Migration `0080_postfach.sql`): nur IDs, Logins, Namen und der
  Betreff einer zugewiesenen Konversation. Die E-Mails bleiben in Exchange.
- **Previews** lesen über Graph dasselbe echte Postfach wie die Produktion, speichern Gelesen und
  Zuständigkeit aber in ihrer eigenen Datenbank und schicken keine Benachrichtigungen. Lokal
  (`dev:mock`) liefert `web/dev/mockPostfach.ts` Demo-Mails.
