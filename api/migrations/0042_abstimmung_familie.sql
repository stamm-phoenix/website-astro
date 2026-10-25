-- Abstimmungen: Einladung an eine Adresse, die sich mehrere CampFlow-Personen teilen (z. B. eine
-- Familie). Diese Teilnahme hält selbst keine Antwort: Jede Person, die über ihren Link abstimmt,
-- bekommt eine eigene Teilnahme mit eigenem Link. `geantwortet_am` zeigt hier nur, dass jemand
-- aus der Familie geantwortet hat, damit die Erinnerung nicht mehr an die Adresse geht
-- (docs/abstimmungen.md).
ALTER TABLE abstimmung.teilnahme ADD familie bit NOT NULL
  CONSTRAINT df_abstimmung_teilnahme_familie DEFAULT 0;
