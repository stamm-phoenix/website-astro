-- Abstimmungen: eine weitere persönliche Einladung derselben Leitung, z. B. an ihren Login und an
-- die Adresse ihrer verknüpften CampFlow-Person. Stimmt die Leitung im Leitendenbereich ab, zeigt
-- `alias_von` auf ihre Teilnahme: Der Link aus dieser Mail öffnet und ändert dann dieselbe Antwort,
-- die Antwort zählt nur einmal, und die Adresse bekommt keine Erinnerung mehr
-- (docs/abstimmungen.md).
ALTER TABLE abstimmung.teilnahme ADD alias_von int NULL
  CONSTRAINT fk_abstimmung_teilnahme_alias REFERENCES abstimmung.teilnahme(id);
