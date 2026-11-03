-- Modul „E-Mail“: bis zu welcher Nachricht eine Konversation als erledigt gilt. Gespeichert wird die
-- Empfangszeit der neuesten Nachricht, die die Person beim Markieren gesehen hat; jede neuere öffnet
-- die Konversation wieder. Ohne Wert (Zeilen von vor dieser Spalte) gilt `am`.
-- Beschreibung: docs/postfaecher.md.

ALTER TABLE postfach.erledigung ADD bis datetime2(3) NULL;
