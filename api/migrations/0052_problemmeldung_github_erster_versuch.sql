-- Problemmeldungen (#270): Beginn des ersten unklaren Versuchs, an GitHub zu senden. Jeder weitere
-- Versuch setzt `github_started_at` neu (die Reservierung); gesucht wird aber ab dem ersten, weil
-- ein Issue schon dort entstanden sein kann, auch wenn spätere Suchen scheiterten.
ALTER TABLE problem.meldung ADD github_first_at datetime2(0) NULL;
