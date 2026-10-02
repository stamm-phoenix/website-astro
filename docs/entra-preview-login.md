# Login auf Preview-Umgebungen (Entra)

Jeder PR bekommt eine eigene Preview unter `https://zealous-water-04f606303-<PR-Nummer>.westeurope.1.azurestaticapps.net`. Damit der Login dort funktioniert, muss `https://<preview-host>/.auth/login/aad/callback` als Redirect-URI in der App-Registrierung der Website stehen. Entra erlaubt dafür keine Wildcards.

Deshalb trägt der Workflow `.github/workflows/azure-static-web-apps-zealous-water-04f606303.yml` die Callback-URL beim Deploy einer Preview per Microsoft Graph ein und entfernt sie wieder, wenn der PR geschlossen wird. Die Logik steckt in `.github/scripts/entra-preview-redirect.sh`. Der Workflow meldet sich per OIDC (Federated Credential) an, es gibt kein Client-Secret.

Solange die Repo-Variablen unten nicht gesetzt sind, überspringt der Workflow diese Schritte.

## Einmalige Einrichtung

Dafür brauchst du ein Konto, das im Tenant App-Registrierungen anlegen und Admin-Consent erteilen darf (z. B. Globaler Administrator oder Privileged Role Administrator).

### 1. App-Registrierung für GitHub Actions anlegen

1. Im [Entra Admin Center](https://entra.microsoft.com) zu **Anwendungen → App-Registrierungen → Neue Registrierung**.
2. Name: `GitHub Actions website-astro`, Kontotyp: **Nur Konten in diesem Organisationsverzeichnis**, keine Redirect-URI.
3. Nach dem Anlegen auf der Übersichtsseite notieren:
   - **Anwendungs-ID (Client)** → wird `ENTRA_DEPLOY_CLIENT_ID`
   - **Verzeichnis-ID (Mandant)** → wird `ENTRA_TENANT_ID`

### 2. Federated Credential auf das Repo

1. In der neuen App: **Zertifikate & Geheimnisse → Verbundanmeldeinformationen → Anmeldeinformationen hinzufügen**.
2. Szenario: **GitHub Actions, die Azure-Ressourcen bereitstellen**.
3. Organisation `stamm-phoenix`, Repository `website-astro`, Entitätstyp **Pull Request**.
4. Prüfen, dass der Antragsteller (Subject) `repo:stamm-phoenix/website-astro:pull_request` lautet und die Zielgruppe `api://AzureADTokenExchange`.
5. Name z. B. `pull-requests`, speichern.

Ein Credential reicht: Sowohl der Deploy als auch das Aufräumen beim Schließen laufen im Event `pull_request`.

### 3. Graph-Berechtigung mit Admin-Consent

1. In der neuen App: **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Anwendungsberechtigungen**.
2. `Application.ReadWrite.OwnedBy` auswählen und hinzufügen.
3. **Administratorzustimmung für <Tenant> erteilen** klicken. Der Status muss danach grün „Gewährt“ zeigen.

`OwnedBy` erlaubt nur Änderungen an App-Registrierungen, deren Besitzer die App selbst ist. Im nächsten Schritt wird sie Besitzer genau der Website-App.

### 4. GitHub-Actions-App als Besitzer der Website-App eintragen

Besitzer muss der **Service Principal** (Unternehmensanwendung) der GitHub-Actions-App sein, nicht die App-Registrierung. Das Portal bietet im Besitzer-Dialog meist nur Benutzer an, deshalb am einfachsten in der [Azure Cloud Shell](https://shell.azure.com) (Bash):

```bash
# Client-ID der GitHub-Actions-App aus Schritt 1
GH_APP_ID=<ENTRA_DEPLOY_CLIENT_ID>
# Client-ID der Website-App (steht in Azure als App-Setting AZURE_CLIENT_ID)
WEBSITE_APP_ID=<AZURE_CLIENT_ID>

SP_ID=$(az ad sp show --id "$GH_APP_ID" --query id -o tsv)
az ad app owner add --id "$WEBSITE_APP_ID" --owner-object-id "$SP_ID"

# Kontrolle: die GitHub-Actions-App sollte jetzt in der Liste stehen
az ad app owner list --id "$WEBSITE_APP_ID" --query "[].displayName" -o tsv

# Objekt-ID der Website-App für Schritt 5
az ad app show --id "$WEBSITE_APP_ID" --query id -o tsv
```

### 5. Repo-Variablen setzen

In GitHub unter **Settings → Secrets and variables → Actions → Variables → New repository variable** drei Variablen anlegen (Variablen, keine Secrets, weil nichts davon geheim ist):

| Variable | Wert |
| --- | --- |
| `ENTRA_TENANT_ID` | Verzeichnis-ID (Mandant) aus Schritt 1 |
| `ENTRA_DEPLOY_CLIENT_ID` | Anwendungs-ID (Client) der GitHub-Actions-App aus Schritt 1 |
| `ENTRA_WEBSITE_APP_OBJECT_ID` | **Objekt-ID** der Website-App aus Schritt 4 (nicht die Client-ID) |

### 6. Testen

Einen PR öffnen oder neu pushen. Im Job **Deploy** sollten die Schritte „Azure login (Entra)“ und „Register preview login callback“ grün sein und im Log `Redirect URIs up to date (add …)` stehen. In der App-Registrierung der Website erscheint unter **Authentifizierung → Web → Umleitungs-URIs** die Callback-URL der Preview, und der Login auf der Preview funktioniert. Nach dem Schließen des PRs entfernt der Job **Close Pull Request** sie wieder.

Für bereits offene PRs reicht ein neuer Push, damit ihre Preview eingetragen wird.

## Hinweise

- Die Prod-URL und alle anderen Redirect-URIs bleiben unberührt. Entfernt werden nur Callbacks auf `*.azurestaticapps.net`, deren Host auf `-<PR-Nummer>` endet.
- Entra erlaubt pro App höchstens 256 Redirect-URIs. Bei normal vielen offenen PRs ist das kein Thema.
- PRs aus Forks bekommen kein OIDC-Token; für sie schlägt schon der Preview-Deploy fehl.
