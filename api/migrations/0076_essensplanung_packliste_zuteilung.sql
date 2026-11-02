-- Essensplanung: Ein Eintrag der Packliste kann mehreren Personen zugeteilt sein („Kochschürze“
-- für Kim, Alex und Sam), und jede hakt ihren Teil selbst ab. Eine Zuteilung ist ein Mitglied
-- der Planung oder ein freier Name. `packliste_eintrag.gepackt` bleibt der Stand des ganzen
-- Eintrags: ohne Zuteilung das eine Häkchen, mit Zuteilungen gepackt, sobald alle gepackt
-- haben (der Code hält das beim Ändern nach). Beschreibung: docs/essensplanung.md (Packliste).
--
-- Rückwärtskompatibel (docs/azure-sql.md): Die bisherige Zuständigkeit wird übernommen;
-- `zustaendig_mitglied_id` und `zustaendig_text` liest der Code nicht mehr, sie kommen in einer
-- späteren Migration weg.

CREATE TABLE essen.packliste_zuteilung (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_packliste_zuteilung PRIMARY KEY,
  version     rowversion     NOT NULL,
  eintrag_id  int            NOT NULL
    CONSTRAINT fk_essen_packliste_zuteilung_eintrag REFERENCES essen.packliste_eintrag(id)
    ON DELETE CASCADE,
  -- Ein Mitglied der Planung (Mitglieder werden nie gelöscht, nur entzogen) oder ein freier Name,
  -- genau eins von beiden. Ohne Kaskade (zweiter Weg von der Planung her); das Löschen der
  -- Planung entfernt die Einträge und mit ihnen die Zuteilungen zuerst.
  mitglied_id int            NULL
    CONSTRAINT fk_essen_packliste_zuteilung_mitglied REFERENCES essen.mitglied(id),
  name        nvarchar(100)  NOT NULL CONSTRAINT df_essen_packliste_zuteilung_name DEFAULT N'',
  gepackt     bit            NOT NULL CONSTRAINT df_essen_packliste_zuteilung_gepackt DEFAULT 0,
  CONSTRAINT ck_essen_packliste_zuteilung_wer CHECK (
    (mitglied_id IS NOT NULL AND name = N'') OR (mitglied_id IS NULL AND LEN(name) > 0)
  )
);
GO

CREATE INDEX ix_essen_packliste_zuteilung_eintrag ON essen.packliste_zuteilung (eintrag_id);
-- Ein Mitglied höchstens einmal je Eintrag; gleiche freie Namen fasst der Code zusammen.
CREATE UNIQUE INDEX uq_essen_packliste_zuteilung_mitglied
  ON essen.packliste_zuteilung (eintrag_id, mitglied_id) WHERE mitglied_id IS NOT NULL;
CREATE INDEX ix_essen_packliste_zuteilung_mitglied ON essen.packliste_zuteilung (mitglied_id)
  WHERE mitglied_id IS NOT NULL;
GO

-- Die bisherige Zuständigkeit wird die eine Zuteilung, mit dem Stand des Eintrags.
INSERT INTO essen.packliste_zuteilung (eintrag_id, mitglied_id, name, gepackt)
SELECT id,
       zustaendig_mitglied_id,
       CASE WHEN zustaendig_mitglied_id IS NULL THEN zustaendig_text ELSE N'' END,
       gepackt
FROM essen.packliste_eintrag
WHERE zustaendig_mitglied_id IS NOT NULL OR LEN(zustaendig_text) > 0;
