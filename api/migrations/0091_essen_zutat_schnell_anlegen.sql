-- Essensplanung: eigene Zutaten lassen sich beim Hinzufügen einer Zeile allein mit ihrem Namen
-- anlegen. Kategorie und Einheitenart bekommen dann einen vorläufigen Wert, die Merkmale bleiben
-- unbekannt; die KI ergänzt danach, was offen ist.
--   angaben_offen:    die Angaben, die die KI noch ergänzen soll, durch Komma getrennt
--                     ('kategorie', 'einheitenart', 'merkmale'); NULL: nichts offen.
--   angaben_geprueft: 0, solange niemand die Angaben einer so angelegten Zutat gespeichert hat.
-- Bestehende Zutaten gelten als geprüft.
ALTER TABLE essen.planung_zutat ADD
  angaben_offen     varchar(40) NULL,
  angaben_geprueft  bit         NOT NULL CONSTRAINT df_essen_planung_zutat_angaben_geprueft DEFAULT 1;
GO
