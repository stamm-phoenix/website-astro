-- Essensplanung (#635): ein Zähler für die zentralen Listen (Zutaten, Kategorien, Unverträglichkeiten).
-- Jede Änderung in der Steuerung erhöht ihn in derselben Transaktion; die Seiten der Planungen
-- lesen beim Abfragen nur diese eine Zeile statt dreier Tabellen zu zählen.
CREATE TABLE essen.katalog_stand (
  id   int    NOT NULL CONSTRAINT pk_essen_katalog_stand PRIMARY KEY CONSTRAINT ck_essen_katalog_stand_id CHECK (id = 1),
  seq  bigint NOT NULL CONSTRAINT df_essen_katalog_stand_seq DEFAULT 0
);
GO
INSERT INTO essen.katalog_stand (id) VALUES (1);
GO
