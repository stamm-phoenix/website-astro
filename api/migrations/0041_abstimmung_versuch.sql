-- Abstimmungen: Kennung des ersten Antwortversuchs über den gemeinsamen Link. Geht die Antwort
-- des Servers verloren und die Seite schickt die Antwort noch einmal, findet sie damit dieselbe
-- Teilnahme, statt eine zweite anzulegen (docs/abstimmungen.md).
ALTER TABLE abstimmung.teilnahme ADD versuch varchar(36) COLLATE Latin1_General_100_BIN2 NULL;
GO

CREATE UNIQUE INDEX uq_abstimmung_teilnahme_versuch ON abstimmung.teilnahme (abstimmung_id, versuch)
  WHERE versuch IS NOT NULL;
