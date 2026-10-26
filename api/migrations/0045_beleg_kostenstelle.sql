-- Belege: Kostenstelle und Kategorie in CampFlow statt der Aktion. Wer einreicht, wählt beides
-- (oder tippt es frei ein), die Kasse bucht den Beleg genau darauf; fehlt eines in CampFlow,
-- legt die Übertragung es vorher an (docs/belege-campflow.md). Gespeichert werden die Namen, weil
-- es frei eingegebene noch nicht gibt. `aktion` bleibt für ältere Belege stehen, die nur sie haben.
ALTER TABLE organisation.beleg ADD
  kostenstelle nvarchar(255) NOT NULL CONSTRAINT df_beleg_kostenstelle DEFAULT N'',
  kategorie    nvarchar(255) NOT NULL CONSTRAINT df_beleg_kategorie DEFAULT N'';
