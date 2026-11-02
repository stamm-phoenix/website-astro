-- Essensplanung (#486): Ein Gericht darf noch keine Referenz-Personenzahl haben, damit man erst den
-- Plan mit Namen füllt und die Rezepte später ausarbeitet. Skalierende Zeilen eines solchen Gerichts
-- zählen nicht in den Bedarf, feste Mengen schon. Die Prüfung (1 bis 2000) bleibt für gesetzte Werte;
-- SQL Server ändert keine Spalte mit CHECK, deshalb wird sie dafür kurz entfernt.
-- Die Spalte essen.mahlzeit.uhrzeit wird nicht mehr gelesen oder geschrieben; ein späterer PR löscht sie.
ALTER TABLE essen.gericht DROP CONSTRAINT ck_essen_gericht_personen;
GO
ALTER TABLE essen.gericht ALTER COLUMN personen smallint NULL;
GO
ALTER TABLE essen.gericht ADD CONSTRAINT ck_essen_gericht_personen
  CHECK (personen IS NULL OR personen BETWEEN 1 AND 2000);
GO
