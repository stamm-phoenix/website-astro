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
wird Outlook nicht nachgebaut: Stand, Zuständigkeit und Anhänge gibt es hier, Antworten,
Löschen und alles Weitere in Outlook („In Outlook öffnen“).

Stand und Zuständigkeit speichert die Website nicht selbst, sondern **in Outlook**, an den
Nachrichten des Postfachs. Was jemand in Outlook tut, zeigt die Website, und umgekehrt:

| Website         | Outlook                                      | Graph                             |
| --------------- | -------------------------------------------- | --------------------------------- |
| Neu             | im Posteingang, kein Fähnchen                | Ordner `inbox`, `notFlagged`      |
| Handlungsbedarf | im Posteingang, Fähnchen                     | Ordner `inbox`, `flagged`         |
| Erledigt        | archiviert (nicht mehr im Posteingang)       | Ordner `archive` oder ein anderer |
| Zuständig       | Kategorie `👤 <Name>` (`ZUSTAENDIG_PRAEFIX`) | `categories`                      |

Der Posteingang ist also die offene Arbeit: Wer in Outlook archiviert oder in einen anderen
Ordner verschiebt, hat die E-Mail damit erledigt.

Den Gelesen-Status von Outlook (`isRead`) zeigt die Website nicht: In einem gemeinsamen Postfach
sagt er nur, ob irgendwer die Nachricht schon angeklickt hat. Ändert jemand auf der Website Stand
oder Zuständigkeit, markiert sie aber alle empfangenen Nachrichten der Konversation in Outlook als
gelesen, damit sie dort nicht mehr fett stehen. Öffnen allein ändert nichts.

## Was das Modul kann

- **Liste:** Die neuesten 100 Nachrichten des Posteingangs und die neuesten 100 des Archivs
  (`INBOX_LIMIT`), nach Konversation (`conversationId` von Exchange) gruppiert, neueste zuerst. Filter in zwei Gruppen, die sich
  kombinieren (`PostfachFilterLeiste.svelte`, `lib/postfachAnsicht.ts`): „Stand“ (Alle, Neu,
  Handlungsbedarf, Erledigt) und „Zuständig“ (Alle, Ich, Niemand). Die Seite beginnt mit allem.
  Jede Zahl sagt, wie viele E-Mails diese Wahl mit dem anderen Filter zeigen würde; passt nichts,
  bietet die Liste „Filter zurücksetzen“. Jede Zeile zeigt ihren Stand (roter Punkt und fett für
  „Neu“, Fähnchen für „Handlungsbedarf“, grüner Haken für „Erledigt“) und wer zuständig ist.
  Erledigte stehen unter „Erledigt“, soweit sie im Archiv liegen; was in einen anderen Ordner
  verschoben wurde, zeigt die Liste nicht. Liegen mehr als 100 Nachrichten im Posteingang oder im
  Archiv, sagt die Liste das
  („Hier stehen die neuesten 100 E-Mails.“ mit Link zu Outlook), und leere Filter behaupten nicht,
  das ganze Postfach sei erledigt.
- **Lesen:** Alle Nachrichten der Konversation aus allen Ordnern, also auch Antworten aus
  „Gesendete Elemente“. HTML wird in einem abgeschotteten Rahmen gezeigt (`MailInhalt.svelte`):
  `sandbox` ohne Skripte und Formulare, eine eigene CSP ohne Netzwerkzugriff. Bilder aus dem
  Internet (oft Zählpixel) laden erst nach „Bilder anzeigen“; eingebettete Bilder (`cid:`) bettet
  die API als `data:`-URL ein (bis 1 MB je Bild, 4 MB je Nachricht). Anhänge bis 25 MB lädt die
  API herunter, immer als Download und nur PNG, JPEG, GIF, WebP und PDF mit ihrem Typ; angehängte
  Nachrichten und größere Dateien gibt es nur in Outlook.
- **Stand einer Konversation** (`statusAus` in `api/lib/postfach-model.ts`), aus den empfangenen
  Nachrichten: Liegt keine mehr im Posteingang, ist sie „Erledigt“. Hat eine im Posteingang ein
  Fähnchen, ist es „Handlungsbedarf“, sonst „Neu“. Eine Antwort nach „Erledigt“ landet im
  Posteingang, die Konversation ist also wieder neu. Gesendete Antworten zählen nicht mit: was in
  „Gesendete Elemente“ liegt, und was das Postfach an andere geschickt und dann verschoben hat;
  Formularnachrichten, die das Postfach an sich selbst schickt, zählen als empfangen.
- **Stand setzen** (`PUT …/{postfach}/status`, `api/lib/postfach-aenderung.ts`): „Erledigt“
  verschiebt die empfangenen Nachrichten aus dem Posteingang ins Archiv (ein noch offenes
  Fähnchen wird vorher erledigt, damit es aus den Aufgaben in Outlook verschwindet). „Neu“ und
  „Handlungsbedarf“ holen eine erledigte Konversation zurück: die archivierten Nachrichten, oder,
  wenn keine im Archiv liegt, die neueste aus ihrem Ordner. „Handlungsbedarf“ setzt das Fähnchen
  nur an der neuesten Nachricht im Posteingang, „Neu“ nimmt es allen dort. Geschrieben und
  verschoben wird nur, was sich ändert. Das kann jede Person, die das Postfach sieht. Die Seite
  schickt mit, welchen Stand sie angezeigt hat (`vorher`) und bis zu welcher Nachricht (`bis`);
  die API liest die Konversation frisch und antwortet mit `409`, wenn inzwischen jemand (auch in
  Outlook) etwas geändert hat oder eine neuere Nachricht gekommen ist. Jede Nachricht wird nur in
  der gelesenen Version geändert und verschoben (`If-Match` mit dem ETag); hat sie jemand
  dazwischen geändert oder gelöscht, kommt ebenfalls `409`. Änderungen derselben Konversation
  laufen je Instanz nacheinander. Konversationen mit mehr als 200 Nachrichten ändert die Website
  nicht (`422`, Hinweis auf Outlook). Hat das Postfach keinen Archivordner, antwortet „Erledigt“
  mit `503 KEIN_ARCHIV`. Wer vorher was gesetzt hat, speichert Outlook nicht.
- **Zuständigkeit** (`PUT …/{postfach}/zustaendig`): pro Konversation eine Person, als Kategorie
  `👤 <Anzeigename>` an allen empfangenen Nachrichten; andere Kategorien bleiben. „Ich kümmere
  mich“ oder „Jemandem zuweisen“ (Mitglieder der Teams des Postfachs, aus Entra ID). Die Website
  ordnet eine Kategorie über den Anzeigenamen einer Person zu (haben zwei Personen denselben Namen, hängt die Website den Anfang des Logins an, z. B. `👤 Lea Leitung (lea.b)`); eine Kategorie mit unbekanntem
  Namen (z. B. von jemandem, der nicht mehr im Team ist) zeigt sie nur als Namen. Wird eine neue
  Konversation jemandem zugewiesen, bekommt sie auch das Fähnchen („Handlungsbedarf“). Die Seite
  schickt mit, welchen Namen sie als zuständig angezeigt hat; hat das inzwischen jemand geändert,
  kommt `409` mit dem aktuellen Namen und nichts wird gespeichert. Beim ersten Zuweisen legt die
  API die Kategorie in der Kategorieliste des Postfachs an, damit Outlook sie farbig zeigt und im
  Menü anbietet (optional, `MailboxSettings.ReadWrite`; ohne geht die Kategorie trotzdem).
- **Mehrere auf einmal:** Mit den Kästchen vor den Zeilen (oder „Alle … auswählen“ für das, was
  der Filter zeigt) wählt man Konversationen aus und setzt für alle denselben Stand („Erledigt und
  archivieren“, „Handlungsbedarf“, „Wieder neu“) oder dieselbe zuständige Person
  (`MehrfachAktionen.svelte`). Den Stand speichert die Seite Konversation für
  Konversation über `PUT …/status`; die Zuständigkeit geht in einem Aufruf an
  `PUT …/{postfach}/zustaendig-mehrere` (`intern-postfach-mehrere.ts`, höchstens 100), der jede
  Konversation für sich mit ihrem `vorher` prüft und eine einzige Mail mit allen Betreffen schickt.
  Was nicht gespeichert wurde (z. B. weil es jemand inzwischen geändert hat), nennt die Seite und
  lässt es ausgewählt.
- **Benachrichtigung:** Wer von jemand anderem zuständig gemacht wird, bekommt eine Mail an das
  eigene Konto (`postfach-mails.ts`, gesendet vom Postfach selbst, ohne Kopie in seinen „Gesendeten Elementen“, damit Betreffe des Vorstands-Postfachs nicht im Kontakt-Postfach landen) mit Betreff, Absender
  und einem Link auf die Konversation (`#konversation=<id>`), ohne den Text der E-Mail. Scheitert
  der Versand, bleibt die Zuständigkeit gespeichert und die Seite sagt, dass man selbst Bescheid
  geben soll. PR-Previews schicken keine solchen Mails, weil sie den Mailversand der Produktion
  teilen.
- **Startseite:** Der Kasten „E-Mails“ zeigt, was auf eine Entscheidung wartet, aus allen
  Postfächern, die die Person sieht (`GET /api/intern/postfach`, `fuerMich`): neue Konversationen
  bei allen, Konversationen mit „Handlungsbedarf“ bei der zuständigen Person, und bei allen,
  solange niemand zuständig ist oder die genannte Person unbekannt ist (z. B. nicht mehr im Team). Erledigte stehen dort nicht.

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

Die API liest und ändert mit ihrer App-Registrierung (`CONFIG.azure.clientId`). Dafür braucht
sie **einmalig**:

1. **Graph-Anwendungsberechtigung `Mail.ReadWrite`** (früher nur `Mail.Read`). Ohne Lesezugriff
   antwortet jede Seite mit „Die Website darf dieses Postfach gerade nicht lesen …“
   (`503 POSTFACH_GESPERRT`, im Log `[postfach] Graph verweigert …`), ohne Schreibzugriff jede
   Änderung mit „Die Website darf in diesem Postfach gerade nichts ändern …“
   (`503 POSTFACH_SCHREIBGESCHUETZT`, im Log `[postfach] Graph verweigert Änderungen an …`).
   Geändert werden nur Fähnchen, Kategorien und der Ordner (Posteingang oder Archiv); der Code
   löscht und sendet keine Nachrichten des Postfachs (außer der Benachrichtigung über
   `Mail.Send`).
2. **Auf die Gruppenpostfächer beschränken.** `Mail.Read` gilt sonst für alle Postfächer des
   Tenants. Mit RBAC for Applications in Exchange Online (Exchange Online PowerShell):

   ```powershell
   New-ServicePrincipal -AppId 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 -ObjectId 50f52211-4d8f-4bfb-9ce1-897649d8c1f9 -DisplayName website-astro
   New-ManagementScope -Name "Website Gruppenpostfaecher" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'kontakt@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'vorstand@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'verein@stamm-phoenix.de' -or PrimarySmtpAddress -eq 'admin@stamm-phoenix.de'"
   New-ManagementRoleAssignment -App 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 -Role "Application Mail.ReadWrite" -CustomResourceScope "Website Gruppenpostfaecher"
   # optional, damit neue Kategorien in Outlook eine Farbe bekommen:
   New-ManagementRoleAssignment -App 5dd5864b-e2c3-4c21-9ef2-8bb3290cd374 -Role "Application MailboxSettings.ReadWrite" -CustomResourceScope "Website Gruppenpostfaecher"
   ```

   Die frühere Rolle `Application Mail.Read` kann danach weg
   (`Get-ManagementRoleAssignment -App 5dd5864b-… | ? Role -eq "Application Mail.Read" | Remove-ManagementRoleAssignment`).
   Keine tenantweite Graph-Berechtigung `Mail.Read`/`Mail.ReadWrite` in der App-Registrierung
   stehen lassen, sonst gilt sie für alle Postfächer; die Exchange-Rolle reicht. Für ein weiteres Postfach den
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
  gelesen, „Neu laden“ und jede eigene Änderung umgehen das; die Personenliste fünf Minuten.
  Änderungen aus Outlook erscheinen also spätestens nach 30 Sekunden oder mit „Neu laden“.
- **Routen** (`api/endpoints/intern-postfach.ts`, alle hinter `requireStaff`):
  `GET /api/intern/postfach`, `GET …/{postfach}`, `GET …/{postfach}/konversation?id=`,
  `GET …/{postfach}/personen`, `PUT …/{postfach}/zustaendig`, `PUT …/{postfach}/zustaendig-mehrere`, `PUT …/{postfach}/status`,
  `GET …/{postfach}/anhang?nachricht=&anhang=`.
- **Daten:** keine eigenen. Das Schema `postfach` (Migrationen `0080`–`0082`) stammt aus der Zeit,
  als die Website Gelesen, Zuständigkeit und Stand selbst gespeichert hat. Der Code liest und
  schreibt es nicht mehr; die Tabellen werden in einem späteren PR entfernt.
- **Previews** lesen und ändern dieselben echten Postfächer wie die Produktion, damit sich der
  Ablauf dort ausprobieren lässt: Was man in einer Preview als erledigt markiert, ist auch in
  Outlook archiviert. Das Testkonto der Previews (`CONFIG.staff.previewOnlyLogins`) bekommt dort
  alle Teamrollen, ohne in den Teams zu sein; es sieht deshalb nur das Postfach der Leitenden
  (`sichtbarePostfaecher`), nie Vorstand-, Förderverein- oder Admin-Postfach. Previews schicken
  keine Benachrichtigungen. Lokal (`dev:mock`) liefert `web/dev/mockPostfach.ts` Demo-Mails mit
  Fähnchen, Kategorien und Ordnern im Speicher.

## Umstellung von der eigenen Datenbank auf Outlook

Bis November 2026 hat die Website Zuständigkeit und Stand in Azure SQL gespeichert. Diese Daten
werden nicht übertragen: Das Modul war erst wenige Tage in Betrieb, und kaum etwas war vergeben.
Nach dem Umstellen ist alles im Posteingang „Neu“; was davon erledigt ist, archiviert man einmal
in Outlook.
