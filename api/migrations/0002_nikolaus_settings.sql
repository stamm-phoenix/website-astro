-- Nikolaus-Steuerung: Einstellungen, die bisher in `api/lib/nikolaus-config.ts`, App Settings
-- und GitHub-Variablen standen, werden im Leitendenbereich (Modul „Steuerung“) gepflegt.
-- Die Startwerte entsprechen der bisherigen Konfiguration.

-- Genau eine Zeile (id = 1).
CREATE TABLE nikolaus.settings (
  id                    tinyint       NOT NULL CONSTRAINT pk_settings PRIMARY KEY
    CONSTRAINT ck_settings_single CHECK (id = 1),
  version               rowversion    NOT NULL,
  -- Öffentliche Seite, Menüeintrag, Banner und Online-Anmeldung.
  public_active         bit           NOT NULL,
  -- Interne Module (Anmeldungen, Dispo, Fahrt, Helfende); die Steuerung bleibt immer erreichbar.
  staff_active          bit           NOT NULL,
  -- Wartungsmodus: alle Schreibzugriffe auf Nikolaus-Daten außer der Steuerung werden abgelehnt.
  maintenance           bit           NOT NULL,
  pending_hold_minutes  smallint      NOT NULL
    CONSTRAINT ck_settings_hold CHECK (pending_hold_minutes BETWEEN 5 AND 1440),
  change_deadline_hours smallint      NOT NULL
    CONSTRAINT ck_settings_deadline CHECK (change_deadline_hours BETWEEN 0 AND 336),
  base_name             nvarchar(100) NOT NULL,
  base_latitude         decimal(9, 6) NOT NULL
    CONSTRAINT ck_settings_latitude CHECK (base_latitude BETWEEN -90 AND 90),
  base_longitude        decimal(9, 6) NOT NULL
    CONSTRAINT ck_settings_longitude CHECK (base_longitude BETWEEN -180 AND 180),
  -- JSON-Array der Postleitzahlen des Einsatzgebiets.
  service_postal_codes  nvarchar(500) NOT NULL
    CONSTRAINT ck_settings_postal_codes
      CHECK (ISJSON(service_postal_codes) = 1 AND LEFT(service_postal_codes, 1) = N'['),
  far_distance_km       decimal(5, 1) NOT NULL
    CONSTRAINT ck_settings_far_distance CHECK (far_distance_km > 0),
  updated_at            datetime2(0)  NOT NULL
    CONSTRAINT df_settings_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by            nvarchar(254) NOT NULL CONSTRAINT df_settings_updated_by DEFAULT N''
);

-- Die Besuchstage. Gespeichert wird immer die ganze Liste zusammen mit `settings`.
CREATE TABLE nikolaus.day (
  date       date    NOT NULL CONSTRAINT pk_day PRIMARY KEY,
  -- Beginn des ersten und Ende des letzten Slots, lokale Zeit Europe/Berlin.
  start_time char(5) NOT NULL
    CONSTRAINT ck_day_start CHECK (start_time LIKE '[0-2][0-9]:[0-5][0-9]'),
  end_time   char(5) NOT NULL
    CONSTRAINT ck_day_end CHECK (end_time LIKE '[0-2][0-9]:[0-5][0-9]'),
  -- Teams des Tages = Buchungen pro Slot (Teams A bis D).
  teams      tinyint NOT NULL CONSTRAINT ck_day_teams CHECK (teams BETWEEN 1 AND 4),
  CONSTRAINT ck_day_times CHECK (start_time < end_time)
);

-- Wer hat wann was an der Steuerung geändert oder gelöscht.
CREATE TABLE nikolaus.audit_log (
  id      int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_audit_log PRIMARY KEY,
  at      datetime2(0)       NOT NULL CONSTRAINT df_audit_log_at DEFAULT SYSUTCDATETIME(),
  actor   nvarchar(254)      NOT NULL,
  action  varchar(40)        NOT NULL,
  -- JSON-Objekt mit den Einzelheiten (geänderte Felder, gelöschte Anzahlen).
  details nvarchar(max)      NOT NULL
    CONSTRAINT ck_audit_log_details CHECK (ISJSON(details) = 1 AND LEFT(details, 1) = N'{')
);
GO

INSERT INTO nikolaus.settings (
  id, public_active, staff_active, maintenance, pending_hold_minutes, change_deadline_hours,
  base_name, base_latitude, base_longitude, service_postal_codes, far_distance_km
) VALUES (
  1, 0, 1, 0, 120, 24,
  N'Pfarrheim', 47.90885, 11.84664, N'["83620","83052"]', 8
);

INSERT INTO nikolaus.day (date, start_time, end_time, teams) VALUES
  ('2026-12-05', '17:00', '21:00', 2),
  ('2026-12-06', '17:00', '21:00', 3);
