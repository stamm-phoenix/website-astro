-- Abstimmungen: weitere Einstellungen beim Anlegen (docs/abstimmungen.md).
-- - max_auswahl: höchstens so viele Optionen darf man mit „Ja“ wählen; NULL: beliebig viele.
--   Ersetzt `mehrfach` (0 entspricht 1). Die Spalte wird hier entfernt, weil das Schema
--   `abstimmung` noch in keiner ausgelieferten Version stand.
-- - vielleicht: Man darf eine Option auch mit „Vielleicht“ wählen.
-- - sichtbarkeit: Wer sieht, wer was gewählt hat. „offen“: alle, die abstimmen; „anonym“: nur die
--   Person, die die Abstimmung angelegt hat, die anderen sehen nur, wer abgestimmt hat;
--   „geheim“: die anderen sehen auch nicht, wer abgestimmt hat.
ALTER TABLE abstimmung.abstimmung ADD
  max_auswahl  smallint   NULL CONSTRAINT ck_abstimmung_max_auswahl CHECK (max_auswahl > 0),
  vielleicht   bit        NOT NULL CONSTRAINT df_abstimmung_vielleicht DEFAULT 0,
  sichtbarkeit varchar(6) NOT NULL CONSTRAINT df_abstimmung_sichtbarkeit DEFAULT 'offen'
    CONSTRAINT ck_abstimmung_sichtbarkeit CHECK (sichtbarkeit IN ('offen', 'anonym', 'geheim'));
GO

UPDATE abstimmung.abstimmung SET max_auswahl = 1 WHERE mehrfach = 0;
ALTER TABLE abstimmung.abstimmung DROP CONSTRAINT df_abstimmung_mehrfach;
ALTER TABLE abstimmung.abstimmung DROP COLUMN mehrfach;

-- 1: die Person hat die Option mit „Vielleicht“ gewählt, 0: mit „Ja“.
ALTER TABLE abstimmung.stimme ADD vielleicht bit NOT NULL
  CONSTRAINT df_abstimmung_stimme_vielleicht DEFAULT 0;
