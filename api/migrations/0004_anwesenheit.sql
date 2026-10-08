-- Anwesenheit in den Gruppenstunden (#217): Leitende haken pro Termin ab, wer da war. Die
-- Kinder kommen aus der CampFlow-Mitgliederliste; gespeichert wird nur ihre CampFlow-ID, der
-- Name wird beim Anzeigen aus CampFlow gelesen. Kinder, die nicht in CampFlow stehen, sind
-- Gäste mit einem Namen als Freitext.
--
-- Nach der Aufbewahrungsfrist (`CONFIG.anwesenheit.retentionMonths`) setzt der Code CampFlow-ID
-- und Gastname auf NULL. Die Zeile bleibt, damit die Statistik weiter zählen kann.

CREATE SCHEMA gruppenstunde;
GO

-- Ein Termin einer Stufe; entsteht beim ersten Abhaken oder beim Speichern des Inhalts.
CREATE TABLE gruppenstunde.meeting (
  id         int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_meeting PRIMARY KEY,
  -- Ändert sich nur mit dem Inhalt; Abhaken schreibt in `attendance`.
  version    rowversion         NOT NULL,
  stufe      nvarchar(20)       NOT NULL
    CONSTRAINT ck_meeting_stufe CHECK (stufe IN (N'Wölflinge', N'Jungpfadfinder', N'Pfadfinder', N'Rover')),
  date       date               NOT NULL,
  -- Was in der Gruppenstunde gemacht wurde, als Text (ohne Namen von Kindern).
  notes      nvarchar(2000)     NOT NULL CONSTRAINT df_meeting_notes DEFAULT N'',
  created_at datetime2(0)       NOT NULL CONSTRAINT df_meeting_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(0)       NOT NULL CONSTRAINT df_meeting_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by nvarchar(254)      NOT NULL CONSTRAINT df_meeting_updated_by DEFAULT N'',
  CONSTRAINT uq_meeting_stufe_date UNIQUE (stufe, date)
);

CREATE INDEX ix_meeting_date ON gruppenstunde.meeting (date);

-- Wer bei einem Termin da war: ein Mitglied (CampFlow-ID) oder ein Gast (Name).
CREATE TABLE gruppenstunde.attendance (
  id         int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_attendance PRIMARY KEY,
  meeting_id int                NOT NULL
    CONSTRAINT fk_attendance_meeting REFERENCES gruppenstunde.meeting (id) ON DELETE CASCADE,
  guest      bit                NOT NULL,
  -- NULL bei Gästen und nach der Aufbewahrungsfrist.
  person_id  varchar(64)        NULL,
  -- NULL bei Mitgliedern und nach der Aufbewahrungsfrist.
  guest_name nvarchar(100)      NULL,
  CONSTRAINT ck_attendance_member CHECK (guest = 1 OR guest_name IS NULL),
  CONSTRAINT ck_attendance_guest CHECK (guest = 0 OR person_id IS NULL),
  CONSTRAINT ck_attendance_guest_name CHECK (guest_name IS NULL OR LEN(guest_name) > 0)
);

CREATE INDEX ix_attendance_meeting ON gruppenstunde.attendance (meeting_id);

-- Ein Mitglied steht pro Termin höchstens einmal in der Liste.
CREATE UNIQUE INDEX uq_attendance_person ON gruppenstunde.attendance (meeting_id, person_id)
  WHERE person_id IS NOT NULL;
