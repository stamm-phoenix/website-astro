-- Essensplanung: Eigene Zutaten einer Planung brauchen beim Anlegen nur noch den Namen.
-- Fehlen Kategorie oder Einheitenart, setzt die API „Sonstiges“ und die Einheitenart der ersten
-- Einheit und markiert die Zutat mit angaben_offen = 1, bis jemand (oder die KI-Prüfung) die
-- Angaben festlegt.
ALTER TABLE essen.planung_zutat
  ADD angaben_offen bit NOT NULL CONSTRAINT df_essen_planung_zutat_angaben_offen DEFAULT 0;
GO
-- Zutaten der Planung, die nichts mehr nutzt, verschwinden seit diesem Stand mit ihrer letzten
-- Nutzung (essen-zutat-aufraeumen.ts). Die bisher liegen gebliebenen werden einmal entfernt.
DELETE pz FROM essen.planung_zutat pz
WHERE NOT EXISTS (SELECT 1 FROM essen.gericht_zutat x WHERE x.planung_zutat_id = pz.id)
  AND NOT EXISTS (SELECT 1 FROM essen.bestand x WHERE x.planung_zutat_id = pz.id)
  AND NOT EXISTS (SELECT 1 FROM essen.zusatzbedarf x WHERE x.planung_zutat_id = pz.id)
  AND NOT EXISTS (SELECT 1 FROM essen.einkauf_posten x WHERE x.planung_zutat_id = pz.id)
  AND NOT EXISTS (SELECT 1 FROM essen.einkauf_regel x WHERE x.planung_zutat_id = pz.id)
  AND NOT EXISTS (SELECT 1 FROM essen.einplanung_verbrauch x WHERE x.planung_zutat_id = pz.id);
GO
