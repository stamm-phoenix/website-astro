-- Mitschriften (#266): Transkripte von Meetings (z. B. der Leitendenrunde) mit KI-Notizen, live
-- aufgenommen oder aus einer hochgeladenen Audiodatei. Gespeichert werden nur Transkript und
-- Notizen; Audio liegt höchstens während eines Transkriptionsauftrags im Blob Storage (siehe
-- `auftrag`) und ist nie abrufbar. Es gibt keine Versionshistorie: Änderungen überschreiben den
-- alten Text, gelöschte Abschnitte werden hart gelöscht. Siehe docs/mitschriften.md.

CREATE SCHEMA mitschrift;
GO

CREATE TABLE mitschrift.mitschrift (
  id               int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_mitschrift PRIMARY KEY,
  -- Ändert sich mit Titel, Datum, Status und Notizen; Abschnitte und Sprecher haben eigene.
  version          rowversion         NOT NULL,
  title            nvarchar(200)      NOT NULL CONSTRAINT ck_mitschrift_title CHECK (LEN(title) > 0),
  meeting_date     date               NOT NULL,
  -- live: Aufnahme läuft; datei: wartet auf die hochgeladene Datei; fertig: abgeschlossen.
  status           varchar(10)        NOT NULL
    CONSTRAINT ck_mitschrift_status CHECK (status IN ('live', 'datei', 'fertig')),
  -- Notizen als JSON (`MitschriftNotizen`), NULL solange keine erzeugt wurden.
  notes            nvarchar(max)      NULL,
  -- Die Notizen wurden von Hand geändert; die KI überschreibt sie nur nach Rückfrage.
  notes_edited     bit                NOT NULL CONSTRAINT df_mitschrift_notes_edited DEFAULT 0,
  -- Das Transkript wurde nach dem Erzeugen der Notizen geändert.
  notes_stale      bit                NOT NULL CONSTRAINT df_mitschrift_notes_stale DEFAULT 0,
  notes_at         datetime2(0)       NULL,
  created_at       datetime2(0)       NOT NULL CONSTRAINT df_mitschrift_created_at DEFAULT SYSUTCDATETIME(),
  created_by       nvarchar(254)      NOT NULL,
  updated_at       datetime2(0)       NOT NULL CONSTRAINT df_mitschrift_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by       nvarchar(254)      NOT NULL CONSTRAINT df_mitschrift_updated_by DEFAULT N''
);

CREATE INDEX ix_mitschrift_meeting_date ON mitschrift.mitschrift (meeting_date DESC, id DESC);

-- Eine erkannte Stimme pro Quelle und Erkennungslauf. Die Sprechertrennung zählt in jedem Lauf
-- neu; Sprecher lassen sich umbenennen und zusammenlegen. Keine Stimmprofile.
CREATE TABLE mitschrift.sprecher (
  id           int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_sprecher PRIMARY KEY,
  version      rowversion         NOT NULL,
  mitschrift_id int               NOT NULL
    CONSTRAINT fk_sprecher_mitschrift REFERENCES mitschrift.mitschrift (id) ON DELETE CASCADE,
  -- raum: Mikrofon; teams: Ton des Teams-Tabs; datei: hochgeladene Datei.
  source       varchar(10)        NOT NULL
    CONSTRAINT ck_sprecher_source CHECK (source IN ('raum', 'teams', 'datei')),
  -- Schlüssel des Erkennungslaufs und der Sprecher-ID von Azure, z. B. `l3:Guest-1` oder `a7:2`.
  [key]        varchar(80)        NOT NULL,
  -- Laufende Nummer pro Mitschrift und Quelle für „Raum – Sprecher 2“.
  number       smallint           NOT NULL,
  -- Von Hand vergebener Name; leer: „<Quelle> – Sprecher <Nummer>“.
  name         nvarchar(100)      NOT NULL CONSTRAINT df_sprecher_name DEFAULT N'',
  CONSTRAINT uq_sprecher_key UNIQUE (mitschrift_id, source, [key])
);

-- Ein Satz des Transkripts. Zeiten in Millisekunden ab Beginn der Aufnahme.
CREATE TABLE mitschrift.abschnitt (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_abschnitt PRIMARY KEY,
  version       rowversion         NOT NULL,
  mitschrift_id int                NOT NULL
    CONSTRAINT fk_abschnitt_mitschrift REFERENCES mitschrift.mitschrift (id) ON DELETE CASCADE,
  -- NULL, wenn die Erkennung keinen Sprecher zuordnen konnte. Kein Fremdschlüssel mit
  -- Kaskade (SQL Server erlaubt nur einen Kaskadenpfad); der Code setzt ihn beim Zusammenlegen um.
  sprecher_id   int                NULL CONSTRAINT fk_abschnitt_sprecher REFERENCES mitschrift.sprecher (id),
  source        varchar(10)        NOT NULL
    CONSTRAINT ck_abschnitt_source CHECK (source IN ('raum', 'teams', 'datei')),
  start_ms      int                NOT NULL CONSTRAINT ck_abschnitt_start CHECK (start_ms >= 0),
  end_ms        int                NOT NULL,
  text          nvarchar(4000)     NOT NULL CONSTRAINT ck_abschnitt_text CHECK (LEN(text) > 0),
  -- Vom Browser vergebene ID eines Live-Satzes, damit ein wiederholtes Senden nichts doppelt.
  client_id     varchar(64)        NULL,
  CONSTRAINT ck_abschnitt_end CHECK (end_ms >= start_ms)
);

CREATE INDEX ix_abschnitt_mitschrift ON mitschrift.abschnitt (mitschrift_id, start_ms, id);
CREATE INDEX ix_abschnitt_sprecher ON mitschrift.abschnitt (sprecher_id) WHERE sprecher_id IS NOT NULL;
CREATE UNIQUE INDEX uq_abschnitt_client ON mitschrift.abschnitt (mitschrift_id, client_id)
  WHERE client_id IS NOT NULL;

-- Ein Batch-Transkriptionsauftrag: eine hochgeladene Datei oder eine Lücke der Live-Aufnahme.
-- Solange es die Zeile gibt, kann ein Blob existieren; sie verschwindet, sobald Blob und
-- Auftrag bei Azure Speech gelöscht sind. Hängende Aufträge räumt der Code nach einer
-- Höchstdauer auf, dazu löscht eine Lifecycle-Regel des Storage-Accounts übrig gebliebene Blobs.
CREATE TABLE mitschrift.auftrag (
  id               int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_auftrag PRIMARY KEY,
  mitschrift_id    int                NOT NULL
    CONSTRAINT fk_auftrag_mitschrift REFERENCES mitschrift.mitschrift (id) ON DELETE CASCADE,
  source           varchar(10)        NOT NULL
    CONSTRAINT ck_auftrag_source CHECK (source IN ('raum', 'teams', 'datei')),
  -- Name des Blobs, `mitschriften/<Mitschrift>/<Zufall>`.
  blob_name        varchar(200)       NOT NULL,
  -- hochladen: Upload-SAS ausgegeben; laeuft: bei Azure Speech; erledigt: Ergebnis gespeichert,
  -- Blob und Auftrag werden noch gelöscht; fehler: fehlgeschlagen (Blob und Auftrag gelöscht).
  status           varchar(10)        NOT NULL
    CONSTRAINT ck_auftrag_status CHECK (status IN ('hochladen', 'laeuft', 'erledigt', 'fehler')),
  -- ID des Auftrags bei Azure Speech (`…/speechtotext/transcriptions/<id>`).
  transcription    varchar(36)        NULL,
  -- Zeitstelle, an der das Ergebnis eingefügt wird (Lücken), und ihr Ende.
  offset_ms        int                NOT NULL CONSTRAINT df_auftrag_offset DEFAULT 0,
  until_ms         int                NULL,
  -- Kurzer Fehlertext ohne Inhalte.
  error            nvarchar(300)      NULL,
  created_at       datetime2(0)       NOT NULL CONSTRAINT df_auftrag_created_at DEFAULT SYSUTCDATETIME(),
  created_by       nvarchar(254)      NOT NULL,
  CONSTRAINT uq_auftrag_blob UNIQUE (blob_name)
);

CREATE INDEX ix_auftrag_mitschrift ON mitschrift.auftrag (mitschrift_id);
CREATE INDEX ix_auftrag_created_at ON mitschrift.auftrag (created_at);
