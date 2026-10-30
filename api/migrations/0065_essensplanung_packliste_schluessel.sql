-- Essensplanung (#452): Der zusammengefasste Name eines Werkzeugs kann länger werden als der
-- Name selbst, weil Kleinschreibung manche Zeichen verlängert („İ“ wird zu „i̇“, zwei Zeichen).
-- Ein Name hat höchstens 100 Zeichen; zusammengefasst sind es höchstens doppelt so viele.

DROP INDEX uq_essen_packliste_eintrag_werkzeug ON essen.packliste_eintrag;
GO

ALTER TABLE essen.packliste_eintrag
  ALTER COLUMN werkzeug nvarchar(200) COLLATE Latin1_General_100_BIN2 NULL;
GO

CREATE UNIQUE INDEX uq_essen_packliste_eintrag_werkzeug ON essen.packliste_eintrag (planung_id, werkzeug)
  WHERE werkzeug IS NOT NULL;
