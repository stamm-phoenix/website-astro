-- Persönliche Eingaben je Aktion: auf allen Geräten verfügbar, mit Versionsschutz.
CREATE TABLE organisation.abrechnung_eingabe (
  user_id varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  event_id varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  login nvarchar(254) NOT NULL,
  session nvarchar(max) NOT NULL CONSTRAINT ck_abrechnung_session CHECK (ISJSON(session) = 1),
  delete_after date NOT NULL,
  updated_at datetime2(0) NOT NULL CONSTRAINT df_abrechnung_updated DEFAULT SYSUTCDATETIME(),
  version rowversion NOT NULL,
  CONSTRAINT pk_abrechnung_eingabe PRIMARY KEY (user_id, event_id)
);
CREATE INDEX ix_abrechnung_expiry ON organisation.abrechnung_eingabe(delete_after);
