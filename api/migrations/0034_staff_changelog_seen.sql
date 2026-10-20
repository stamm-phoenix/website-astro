-- Welche Neuigkeiten im Leitendenbereich eine angemeldete Person schon gesehen hat: Die Bubble im
-- Menü und auf der Startseite zählt nur die Einträge, die neuer sind als der gespeicherte. Gespeichert
-- wird die ID des neuesten gesehenen Eintrags (`web/src/lib/changelogEntries.ts`), nie ein älterer
-- als der vorhandene. Fehlt die Zeile, hat die Person noch keine Neuigkeiten geöffnet.

CREATE TABLE organisation.staff_changelog_seen (
  -- Benutzer-ID, die Static Web Apps nach der Anmeldung übergibt (`userId` des Principals).
  user_id      varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT pk_staff_changelog_seen PRIMARY KEY,
  -- Login (Adresse des Microsoft-Kontos), nur zum Nachsehen, z. B. wenn jemand den Stamm verlässt.
  login        nvarchar(254) NOT NULL,
  -- ID des neuesten gesehenen Eintrags, z. B. 2026-10-20-neuigkeiten. IDs beginnen mit dem Datum
  -- und lassen sich deshalb als Text der Reihe nach vergleichen.
  last_seen_id varchar(80)   COLLATE Latin1_General_100_BIN2 NOT NULL,
  updated_at   datetime2(0)  NOT NULL CONSTRAINT df_staff_changelog_seen_updated_at DEFAULT SYSUTCDATETIME()
);
