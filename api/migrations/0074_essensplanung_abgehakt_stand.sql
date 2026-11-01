-- Essensplanung (#486): Ob ein Posten ohne Menge erledigt ist, entscheidet der Vergleich des
-- Häkchens mit dem neuesten mengenlosen Zusatzbedarf. Bisher war das die rowversion des
-- abgehakten Postens; die ändert sich aber auch, wenn seine Einheit vereinheitlicht wird, und
-- dann galt später hinzugefügter Zusatzbedarf fälschlich als erledigt. `abgehakt_stand` hält den
-- Stand der Datenbank (@@DBTS) beim Abhaken fest und ändert sich nur beim Abhaken.
-- Beschreibung: docs/essensplanung.md („Einheiten“). Rückwärtskompatibel: neue Spalte, NULL
-- erlaubt; bestehende Häkchen übernehmen ihre bisherige Version.

ALTER TABLE essen.einkauf_posten ADD abgehakt_stand binary(8) NULL;
GO

UPDATE essen.einkauf_posten SET abgehakt_stand = CAST(version AS binary(8));
