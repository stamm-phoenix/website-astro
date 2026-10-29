-- Essensplanung (#452): Packliste einer Planung. Die Werkzeuge der eingeplanten Gerichte rechnet die
-- Seite selbst zusammen; gespeichert wird nur, was jemand an einem Werkzeug setzt (gepackt,
-- zuständig), und die eigenen Einträge. Beschreibung: docs/essensplanung.md.

CREATE TABLE essen.packliste_eintrag (
  id                     int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_packliste_eintrag PRIMARY KEY,
  version                rowversion     NOT NULL,
  planung_id             int            NOT NULL
    CONSTRAINT fk_essen_packliste_eintrag_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  -- Der zusammengefasste Name eines Werkzeugs (getrimmt, klein geschrieben); NULL bei einem
  -- eigenen Eintrag. Binär verglichen: Die Seite fasst schon zusammen, und „ß“ ist nicht „ss“.
  werkzeug               nvarchar(100)  COLLATE Latin1_General_100_BIN2 NULL,
  -- Der angezeigte Name: der eigene Eintrag oder das Werkzeug, wie es zuerst gesetzt wurde.
  name                   nvarchar(100)  NOT NULL CONSTRAINT ck_essen_packliste_eintrag_name CHECK (LEN(name) > 0),
  gepackt                bit            NOT NULL CONSTRAINT df_essen_packliste_eintrag_gepackt DEFAULT 0,
  -- Zuständig: ein Mitglied der Planung (Mitglieder werden nie gelöscht, nur entzogen) oder ein
  -- freier Name, höchstens eins von beiden. Ohne Kaskade (zweiter Weg von der Planung her);
  -- das Löschen der Planung entfernt die Einträge zuerst.
  zustaendig_mitglied_id int            NULL
    CONSTRAINT fk_essen_packliste_eintrag_mitglied REFERENCES essen.mitglied(id),
  zustaendig_text        nvarchar(100)  NOT NULL CONSTRAINT df_essen_packliste_eintrag_zustaendig_text DEFAULT N'',
  CONSTRAINT ck_essen_packliste_eintrag_zustaendig
    CHECK (zustaendig_mitglied_id IS NULL OR zustaendig_text = N'')
);
GO

CREATE INDEX ix_essen_packliste_eintrag_planung ON essen.packliste_eintrag (planung_id);
-- Höchstens ein gespeicherter Zustand je Werkzeug und Planung.
CREATE UNIQUE INDEX uq_essen_packliste_eintrag_werkzeug ON essen.packliste_eintrag (planung_id, werkzeug)
  WHERE werkzeug IS NOT NULL;
CREATE INDEX ix_essen_packliste_eintrag_mitglied ON essen.packliste_eintrag (zustaendig_mitglied_id)
  WHERE zustaendig_mitglied_id IS NOT NULL;
