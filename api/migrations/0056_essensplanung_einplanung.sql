-- Essensplanung (#452): Gerichte an Mahlzeiten einplanen.
-- Beschreibung: docs/essensplanung.md.

-- Ein Gericht an einer Mahlzeit, in der Reihenfolge der Mahlzeit (z. B. Haupt- und Nachspeise).
CREATE TABLE essen.einplanung (
  id                    int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_einplanung PRIMARY KEY,
  version               rowversion     NOT NULL,
  -- Mit der Mahlzeit (und ihrem Tag) verschwindet die Einplanung.
  mahlzeit_id           int            NOT NULL
    CONSTRAINT fk_essen_einplanung_mahlzeit REFERENCES essen.mahlzeit(id) ON DELETE CASCADE,
  -- Ohne Kaskade: SQL Server erlaubt keinen zweiten Weg von der Planung her. Das Löschen eines
  -- Gerichts (und der Planung) entfernt seine Einplanungen zuerst.
  gericht_id            int            NOT NULL
    CONSTRAINT fk_essen_einplanung_gericht REFERENCES essen.gericht(id),
  position              smallint       NOT NULL,
  -- Mengen des Gerichts mal Faktor, z. B. 0,5, wenn nur die Hälfte Nachtisch isst.
  faktor                decimal(6, 3)  NOT NULL CONSTRAINT df_essen_einplanung_faktor DEFAULT 1
    CONSTRAINT ck_essen_einplanung_faktor CHECK (faktor > 0 AND faktor <= 20),
  -- Zuständig: ein Mitglied der Planung (Mitglieder werden nie gelöscht, nur entzogen) oder ein
  -- freier Name, höchstens eins von beiden.
  zustaendig_mitglied_id int           NULL
    CONSTRAINT fk_essen_einplanung_mitglied REFERENCES essen.mitglied(id),
  zustaendig_text       nvarchar(100)  NOT NULL CONSTRAINT df_essen_einplanung_zustaendig_text DEFAULT N'',
  CONSTRAINT ck_essen_einplanung_zustaendig CHECK (zustaendig_mitglied_id IS NULL OR zustaendig_text = N'')
);
CREATE INDEX ix_essen_einplanung_mahlzeit ON essen.einplanung (mahlzeit_id, position);
CREATE INDEX ix_essen_einplanung_gericht ON essen.einplanung (gericht_id);
CREATE INDEX ix_essen_einplanung_mitglied ON essen.einplanung (zustaendig_mitglied_id)
  WHERE zustaendig_mitglied_id IS NOT NULL;
