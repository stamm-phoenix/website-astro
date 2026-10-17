-- Einstellungen im Leitendenbereich, pro angemeldeter Person: Wahlen, die auf jedem Gerät
-- gelten sollen, als ein JSON-Objekt je Account. Heute nur `protokollText` (`markdown` oder
-- `formatiert`, #320); weitere Schlüssel kommen ohne neue Tabelle dazu. Fehlt die Zeile, gelten
-- die Voreinstellungen.

CREATE TABLE organisation.staff_settings (
  -- Benutzer-ID, die Static Web Apps nach der Anmeldung übergibt (`userId` des Principals).
  user_id    varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT pk_staff_settings PRIMARY KEY,
  -- Login der Person, nur zum Nachsehen, z. B. wenn jemand den Stamm verlässt.
  login      nvarchar(254) NOT NULL,
  -- JSON-Objekt, z. B. {"protokollText":"markdown"}.
  settings   nvarchar(max) NOT NULL CONSTRAINT ck_staff_settings_settings CHECK (ISJSON(settings) = 1),
  updated_at datetime2(0)  NOT NULL CONSTRAINT df_staff_settings_updated_at DEFAULT SYSUTCDATETIME()
);
