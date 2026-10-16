-- Favoriten im Leitendenbereich: die Module, die eine angemeldete Person auf der Startseite
-- oben sehen will. Bisher nur im Browser gespeichert; hier gelten sie auf jedem Gerät.
-- Eine Zeile pro Account; fehlt sie, hat die Person noch nie Favoriten gespeichert, und die
-- Startseite übernimmt einmalig eine ältere Auswahl aus dem Browser (`StaffDashboard.svelte`).

CREATE TABLE organisation.staff_favorites (
  -- Benutzer-ID, die Static Web Apps nach der Anmeldung übergibt (`userId` des Principals).
  user_id    varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT pk_staff_favorites PRIMARY KEY,
  -- Login der Person, nur zum Nachsehen, z. B. wenn jemand den Stamm verlässt.
  login      nvarchar(254) NOT NULL,
  -- JSON-Liste der Pfade der Module, z. B. ["/leitendenbereich/aufgaben"].
  modules    nvarchar(max) NOT NULL CONSTRAINT ck_staff_favorites_modules CHECK (ISJSON(modules) = 1),
  updated_at datetime2(0)  NOT NULL CONSTRAINT df_staff_favorites_updated_at DEFAULT SYSUTCDATETIME()
);
