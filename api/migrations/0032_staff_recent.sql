-- Zuletzt genutzte Bereiche im Leitendenbereich, pro angemeldeter Person: die Startseite und die
-- Leiste unten auf dem Handy bieten sie neben den Favoriten an. Jeder Aufruf eines Moduls stellt
-- es nach vorn; gespeichert werden nur die letzten wenigen. Fehlt die Zeile, war die Person noch
-- in keinem Modul.

CREATE TABLE organisation.staff_recent (
  -- Benutzer-ID, die Static Web Apps nach der Anmeldung übergibt (`userId` des Principals).
  user_id    varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT pk_staff_recent PRIMARY KEY,
  -- Login der Person, nur zum Nachsehen, z. B. wenn jemand den Stamm verlässt.
  login      nvarchar(254) NOT NULL,
  -- JSON-Liste der Modulpfade, der zuletzt aufgerufene zuerst.
  modules    nvarchar(max) NOT NULL CONSTRAINT ck_staff_recent_modules CHECK (ISJSON(modules) = 1),
  updated_at datetime2(0)  NOT NULL CONSTRAINT df_staff_recent_updated_at DEFAULT SYSUTCDATETIME()
);
