-- Planungen, die je ein Foto eines Belegs im Blob Storage hatten (essen-belege/<planung_id>/). Die
-- Zeile entsteht, bevor das erste Foto geschrieben wird, und bleibt, solange es die Planung gibt.
-- Beim Löschen der Planung wird ihr Ordner dann immer zum Aufräumen vorgemerkt
-- (essen.beleg_ordner_loeschen), auch wenn kein Beleg mehr ein Foto nennt, aber Reste eines
-- gescheiterten Aufräumens geblieben sein können.
CREATE TABLE essen.beleg_ordner (
  planung_id   int          NOT NULL CONSTRAINT pk_essen_beleg_ordner PRIMARY KEY
    CONSTRAINT fk_essen_beleg_ordner_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  angelegt_am  datetime2(0) NOT NULL CONSTRAINT df_essen_beleg_ordner_angelegt_am DEFAULT SYSUTCDATETIME()
);
GO

-- Planungen, die schon Fotos haben, bekommen ihren Vermerk nachträglich.
INSERT INTO essen.beleg_ordner (planung_id)
SELECT DISTINCT planung_id FROM essen.beleg WHERE foto IS NOT NULL;
