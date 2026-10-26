# Berechtigungen über Microsoft Teams

Wer was im Leitendenbereich darf, richtet sich nach der Mitgliedschaft in unseren Teams in
Microsoft Teams (den Microsoft-365-Gruppen dahinter). Ein Microsoft-Konto des Stammes allein
reicht nicht: Gäste, die aus anderen Gründen ein Konto haben, kommen nicht hinein.

## Teams und Rollen

| Team (Mail-Alias) | Rolle           | Erlaubt                                                          |
| ----------------- | --------------- | ---------------------------------------------------------------- |
| `team-leitende`   | `team_leitende` | Leitendenbereich (`/leitendenbereich/*`, `/api/intern/*`)        |
| `team-kasse`      | `team_kasse`    | Belege: alle sehen, annehmen, ablehnen, nach CampFlow übertragen; Kostenstellen |
| `team-vorstand`   | `team_vorstand` | Kostenstellen (Summen je Kostenstelle und Kategorie aus CampFlow) |

Die Gruppen-IDs stehen in `CONFIG.staff.teams` (`api/lib/config.ts`). Rollennamen von Static
Web Apps dürfen nur Buchstaben, Ziffern und `_` enthalten, deshalb `team_leitende` statt
`team-leitende`.

## Ablauf

1. Nach jeder Anmeldung ruft Static Web Apps `POST /api/GetRoles` auf (`rolesSource` in
   `web/public/staticwebapp.config.json`, Code in `api/endpoints/get-roles.ts` und
   `api/lib/staff-roles.ts`). Von außen ist die Function nicht erreichbar.
2. Die Function fragt mit der App-Registrierung der API bei Microsoft Graph
   (`POST /users/{id}/checkMemberGroups`), in welchen der Teams die Person ist, auch über
   verschachtelte Gruppen. Dafür braucht die App `GroupMember.Read.All` (Anwendungsberechtigung,
   vorhanden). Sie gibt die passenden Rollen zurück.
3. Static Web Apps speichert die Rollen in der Sitzung. Sie stehen in `/.auth/me` und im Header
   `x-ms-client-principal`, den die API bekommt.
4. Die Routen verlangen `team_leitende`. Wer angemeldet ist, aber die Rolle nicht hat, sieht
   `/kein-zugang` (`responseOverrides.403`) mit einem Knopf zum Ab- und Neuanmelden.
5. Die API prüft zusätzlich: `requireStaff` verlangt `team_leitende` (sonst `403 NOT_IN_TEAM`),
   die Belege prüfen `hasTeam(principal, 'kasse')`, die Kostenstellen
   (`GET /api/intern/kostenstellen/summen`) `kasse` oder `vorstand`. Menü, Suche und Startseite zeigen
   die Seite `/leitendenbereich/kostenstellen` nur mit einer der beiden Rollen (`roles` in
   `staffModules.ts`); wer sie ohne aufruft, sieht nur die Fehlermeldung der API.

## Was man wissen muss

- **Änderungen gelten erst nach einer neuen Anmeldung.** Wer neu in ein Team kommt, meldet
  sich ab und wieder an. Wer ein Team verlässt, behält die Rolle, bis die Sitzung abläuft.
- **Nach dem ersten Deploy** haben alle, die schon angemeldet waren, noch keine Rollen und
  landen auf „Kein Zugang“. Einmal ab- und anmelden genügt.
- **Antwortet Graph nicht**, bekommt die Person keine Rollen und sieht „Kein Zugang“. Ein neuer
  Login versucht es noch einmal. Der Fehler steht im Log der Function (`[rollen]`).
- **Das Preview-Testkonto** (`CONFIG.staff.previewOnlyLogins`) bekommt auf PR-Previews alle
  Rollen, ohne in einem Team zu sein, und auf der Produktion keine
  ([preview-testkonto.md](preview-testkonto.md)).
- **Lokal:** `dev:mock` meldet als Leitende, Kasse und Vorstand an (`web/dev/mockApi.ts`). Bei `dev:full`
  ruft die SWA CLI `GetRoles` nicht auf; die Rollen trägt man im Mock-Login selbst ein.

## Neues Team oder neue Prüfung

1. Team mit Gruppen-ID und Rolle in `CONFIG.staff.teams` eintragen (der Typ `StaffTeam` in
   `api/lib/config.ts` bekommt den neuen Namen).
2. In der API mit `hasTeam(principal, '<team>')` prüfen. Die Oberfläche fragt die API, ob sie
   die Bedienelemente zeigen soll (wie `GET /api/intern/pflege/belege/rolle`), statt selbst
   Rollen zu lesen.
3. Ist ein ganzes Modul nur für ein Team, bekommt es in `staffModules.ts` `roles`, damit es nur
   sieht, wer es öffnen darf. Keine eigene Route mit `allowedRoles` in
   `staticwebapp.config.json`: `allowedRoles` gilt als ODER und die erste passende Route gewinnt,
   eine solche Route ließe also Teammitglieder ohne `team_leitende` in den Leitendenbereich. Die
   Daten schützt die API-Prüfung.
4. Die Tabelle oben ergänzen.
