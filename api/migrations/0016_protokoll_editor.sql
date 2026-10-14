-- Protokoll-Editor (#277): Protokolle der Leitendenrunde werden auf der Website geschrieben statt
-- in Word. Eine Person schreibt (Bearbeitungssperre), alle anderen lesen live mit. Der Inhalt
-- wird laufend gespeichert; Versionsstände sichern frühere Fassungen. Siehe
-- docs/protokoll-editor.md. Die Word-Protokolle in SharePoint (organisation.protokoll) bleiben.

CREATE SCHEMA protokoll;
GO

CREATE TABLE protokoll.protokoll (
  id           int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_protokoll_editor PRIMARY KEY,
  -- Ändert sich mit Titel, Datum, Status und Inhalt; die Sperre hat eine eigene Tabelle, damit
  -- ihr Verlängern die Version nicht ändert.
  version      rowversion         NOT NULL,
  title        nvarchar(200)      NOT NULL CONSTRAINT ck_protokoll_editor_title CHECK (LEN(title) > 0),
  meeting_date date               NOT NULL,
  -- entwurf: wird geschrieben; die weiteren Werte folgen mit Review und Versand.
  status       varchar(12)        NOT NULL CONSTRAINT df_protokoll_editor_status DEFAULT 'entwurf'
    CONSTRAINT ck_protokoll_editor_status
      CHECK (status IN ('entwurf', 'review', 'freigegeben', 'verschickt')),
  -- Kopfdaten, Tagesordnungspunkte und nächste Sitzung als JSON (`ProtokollInhalt`).
  content      nvarchar(max)      NOT NULL CONSTRAINT ck_protokoll_editor_content CHECK (ISJSON(content) = 1),
  created_at   datetime2(0)       NOT NULL CONSTRAINT df_protokoll_editor_created_at DEFAULT SYSUTCDATETIME(),
  created_by   nvarchar(254)      NOT NULL,
  updated_at   datetime2(0)       NOT NULL CONSTRAINT df_protokoll_editor_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by   nvarchar(254)      NOT NULL
);

CREATE INDEX ix_protokoll_editor_date ON protokoll.protokoll (meeting_date DESC, id DESC);

-- Wer gerade schreibt. Höchstens eine Zeile pro Protokoll; abgelaufene Sperren dürfen alle
-- übernehmen. `token` unterscheidet Tabs und Geräte derselben Person.
CREATE TABLE protokoll.sperre (
  protokoll_id   int           NOT NULL CONSTRAINT pk_protokoll_sperre PRIMARY KEY
    CONSTRAINT fk_protokoll_sperre REFERENCES protokoll.protokoll (id) ON DELETE CASCADE,
  login          nvarchar(254) NOT NULL,
  name           nvarchar(200) NOT NULL,
  token          varchar(64)   NOT NULL,
  since          datetime2(0)  NOT NULL,
  until          datetime2(3)  NOT NULL,
  -- Tagesordnungspunkt, an dem gerade geschrieben wird („Mitlaufen“ der Lesenden).
  aktiver_punkt  varchar(40)   NULL
);

-- Gesicherte Fassungen: beim Speichern höchstens alle paar Minuten, außerdem vor dem Übernehmen
-- der Bearbeitung und vor dem Überschreiben mit einer lokalen Fassung.
CREATE TABLE protokoll.revision (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_protokoll_revision PRIMARY KEY,
  protokoll_id  int                NOT NULL
    CONSTRAINT fk_protokoll_revision REFERENCES protokoll.protokoll (id) ON DELETE CASCADE,
  title         nvarchar(200)      NOT NULL,
  meeting_date  date               NOT NULL,
  content       nvarchar(max)      NOT NULL CONSTRAINT ck_protokoll_revision_content CHECK (ISJSON(content) = 1),
  -- speichern: regelmäßige Sicherung; uebernahme: vor dem Übernehmen der Bearbeitung;
  -- ueberschreiben: vor dem Übernehmen einer lokalen Fassung; wiederherstellen: vor dem
  -- Zurückholen einer älteren Fassung.
  reason        varchar(16)        NOT NULL
    CONSTRAINT ck_protokoll_revision_reason
      CHECK (reason IN ('speichern', 'uebernahme', 'ueberschreiben', 'wiederherstellen')),
  saved_at      datetime2(0)       NOT NULL CONSTRAINT df_protokoll_revision_saved_at DEFAULT SYSUTCDATETIME(),
  saved_by      nvarchar(254)      NOT NULL
);

CREATE INDEX ix_protokoll_revision ON protokoll.revision (protokoll_id, saved_at DESC, id DESC);
