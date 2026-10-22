# Testkonto für PR-Previews (Claude Code)

Mit einem eigenen Testkonto kann Claude Code (oder jede andere automatisierte Prüfung) sich auf einer PR-Preview anmelden und den Leitendenbereich dort mit der echten API, dem echten Routing von Static Web Apps und den Testdaten der Preview-Datenbank anschauen. `bun run dev:mock` bleibt für schnelle Prüfungen mit Demodaten. Die Preview zeigt dagegen, wie sich ein PR nach dem Deploy wirklich verhält.

## Wie es geschützt ist

- Das Konto steht in `CONFIG.staff.previewOnlyLogins` (`api/lib/config.ts`). `requireStaff` (`api/lib/staff-auth.ts`) lehnt es außerhalb von PR-Previews mit `403 PREVIEW_ONLY` ab. Damit sieht es auf der Produktion keine Daten. Seine Rollen bekommt es nicht aus den Teams: `GetRoles` gibt ihm auf PR-Previews alle Rollen aus `CONFIG.staff.teams` (Leitende und Kasse) und sonst keine, also kommt es auf der Produktion nicht einmal in den Leitendenbereich (`docs/berechtigungen.md`).
- Previews haben eine eigene Datenbank und einen eigenen Blob-Container mit Testdaten (`docs/azure-sql.md`). Nicht abgetrennt sind aber zum Beispiel SharePoint (Fotos, Protokoll-Dateien), CampFlow und der Mailversand. Auf Previews also keine Mails, Uploads oder CampFlow-Änderungen auslösen, die nicht zum Test gehören.
- Das Konto behält seine Zwei-Faktor-Anmeldung. Das Skript erzeugt den Code aus dem TOTP-Schlüssel, wie es eine Authenticator-App tut.
- Die Zugangsdaten liegen nur in den Einstellungen der Claude-Code-Umgebung. Alles, was in einer Session läuft, kann sie lesen. Gib dem Konto deshalb keine weiteren Rechte, keine Lizenz und keine Gruppen.

## Einmalige Einrichtung

### 1. Konto in Entra anlegen

1. Im [Entra Admin Center](https://entra.microsoft.com) unter **Benutzer → Neuer Benutzer → Benutzer erstellen**:
   - Benutzerprinzipalname: `claude-preview@stamm-phoenix.de` (ein anderer Name muss auch in `CONFIG.staff.previewOnlyLogins` geändert werden)
   - Anzeigename: `Claude Preview-Test`
   - ein langes, zufälliges Passwort
2. Keine Lizenz, keine Gruppen (vor allem nicht die Leitendengruppe aus `CONFIG.taskDirectory.groupId`), keine Rollen.
3. Falls Richtlinien für bedingten Zugriff nur bestimmte Geräte oder Orte erlauben, das Konto davon ausnehmen. Die Anmeldung kommt aus einem Rechenzentrum, ohne verwaltetes Gerät. Die Zwei-Faktor-Pflicht bleibt bestehen.

### 2. Zwei-Faktor-Anmeldung mit TOTP-Schlüssel einrichten

1. In einem privaten Browserfenster mit dem neuen Konto bei <https://mysignins.microsoft.com/security-info> anmelden und das Passwort ändern, falls verlangt.
2. **Anmeldemethode hinzufügen → Authenticator-App → Ich möchte eine andere Authentifikator-App verwenden → Weiter**.
3. Beim QR-Code **Bild kann nicht gescannt werden?** wählen und den **Geheimen Schlüssel** kopieren (Base32, z. B. `abcd efgh …`). Das ist `PREVIEW_TEST_TOTP_SECRET`.
4. Den Code einmal bestätigen, z. B. mit `oathtool --totp -b "<Schlüssel>"` oder einer Authenticator-App, in die du denselben Schlüssel einträgst.
5. Die Authenticator-App als **Standardanmeldemethode** setzen, falls Entra eine andere vorschlägt. Eine Telefonnummer oder eine Push-App gibt es für das Konto nicht.

### 3. Werte in der Claude-Code-Umgebung hinterlegen

In Claude Code im Web: Umgebungsmenü in der Titelleiste der Session → **Edit** → Umgebungsvariablen:

| Variable                              | Wert                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PREVIEW_TEST_LOGIN`                  | `claude-preview@stamm-phoenix.de`                                                                                               |
| `PREVIEW_TEST_PASSWORD`               | Passwort aus Schritt 1                                                                                                          |
| `PREVIEW_TEST_TOTP_SECRET`            | Schlüssel aus Schritt 2                                                                                                         |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | `/opt/pw-browsers/chromium` (das vorinstallierte Chromium; die Playwright-Version im Repo erwartet sonst einen anderen Browser) |

Nicht in den Chat einfügen und nicht ins Repo schreiben. Eine neue Session übernimmt die Werte.

## Benutzen

Die Adresse der Preview steht im Kommentar „Your stage site is ready!“ am PR (die Region im Hostnamen ändert sich, deshalb nimmt das Skript keine PR-Nummer).

```bash
cd web
# Anmelden, Sitzung in test-results/preview-auth/<host>.json speichern
bun scripts/preview-login.ts https://zealous-water-04f606303-123.westeurope.1.azurestaticapps.net

# Zusätzlich Screenshots in test-results/preview-shots/ (390px breit, --width für andere Breiten)
bun scripts/preview-login.ts https://zealous-water-04f606303-123.westeurope.1.azurestaticapps.net \
  --shot /leitendenbereich/ --shot /leitendenbereich/aufgaben/
```

Eine gespeicherte Sitzung wird wiederverwendet, solange sie gültig ist. Eigene Playwright-Skripte können sie als `storageState` laden.

Das Skript nimmt nur Previews dieser Static Web App an. Meldet es „Microsoft refused the login“ oder „The login got stuck“, zeigt die Meldung den Text oder die Adresse der Anmeldeseite. Häufige Ursachen: abgelaufenes Passwort, eine andere Standardmethode als die Authenticator-App oder eine Richtlinie für bedingten Zugriff. Antwortet die API nach der Anmeldung mit `403 PREVIEW_ONLY`, stimmt die Adresse nicht zu einer Preview, oder ihre `deployment.ts` wurde nicht geschrieben.

## Konto sperren

Wenn das Konto nicht mehr gebraucht wird oder die Zugangsdaten bekannt geworden sein könnten: in Entra **Anmeldung blockieren** und die Sitzungen widerrufen, dann die Variablen aus der Umgebung entfernen.
