-- Erinnerungen an die nächste Leitendenrunde (#184): pro Termin, Erinnerungsstufe und
-- Empfänger*in höchstens eine Zeile. Sie wird vor dem Versand reserviert, damit parallele Läufe
-- und Wiederholungen nie doppelt mailen; ein unklares Ergebnis bleibt als `uncertain` stehen.
-- Die Adressen selbst werden nicht gespeichert, nur ihr Hash. Siehe docs/aufgaben-timer.md.
CREATE TABLE protokoll.erinnerung (
  id             int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_protokoll_erinnerung PRIMARY KEY,
  version        rowversion         NOT NULL,
  -- Berliner Ortszeit des Termins: `YYYY-MM-DD` oder `YYYY-MM-DDTHH:MM`, wenn die Uhrzeit bekannt ist.
  -- Ein geänderter Termin hat einen anderen Schlüssel; Erinnerungen an den alten Termin entfallen.
  meeting_key    varchar(16)        NOT NULL,
  meeting_date   date               NOT NULL,
  -- Beginn des Termins in UTC, ohne Uhrzeit das Ende des Tages. Danach wird nichts mehr versendet.
  meeting_at     datetime2(0)       NOT NULL,
  -- Protokoll, aus dem der Termin stammt: `editor:<id>` oder `word:<Datei>`.
  protokoll_ref  varchar(80)        NOT NULL,
  -- Erinnerungsstufe: so viele Tage vor dem Termin.
  days_before    tinyint            NOT NULL,
  recipient_hash char(64)           NOT NULL,
  status         varchar(12)        NOT NULL CONSTRAINT ck_protokoll_erinnerung_status
    CHECK (status IN ('attempted', 'sent', 'uncertain', 'failed', 'retryable')),
  attempted_at   datetime2(0)       NOT NULL CONSTRAINT df_protokoll_erinnerung_attempted DEFAULT SYSUTCDATETIME(),
  sent_at        datetime2(0)       NULL,
  retry_after    datetime2(0)       NULL,
  CONSTRAINT uq_protokoll_erinnerung UNIQUE (meeting_key, days_before, recipient_hash)
);

CREATE INDEX ix_protokoll_erinnerung_date ON protokoll.erinnerung (meeting_date);
