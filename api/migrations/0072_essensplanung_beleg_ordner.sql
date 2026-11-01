-- Foto-Ordner gelöschter Planungen, die noch im Blob Storage aufzuräumen sind. Die Zeile entsteht
-- in derselben Transaktion, die die Planung löscht; nach dem Commit löscht die API den Ordner und
-- dann die Zeile. Scheitert das, holt es das nächste Löschen einer Planung oder die Aufbewahrung
-- nach. Ohne Fremdschlüssel: die Planung gibt es dann nicht mehr.
CREATE TABLE essen.beleg_ordner_loeschen (
  planung_id   int          NOT NULL CONSTRAINT pk_essen_beleg_ordner_loeschen PRIMARY KEY,
  angelegt_am  datetime2(0) NOT NULL CONSTRAINT df_essen_beleg_ordner_loeschen_angelegt_am DEFAULT SYSUTCDATETIME()
);
