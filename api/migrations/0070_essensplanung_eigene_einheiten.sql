-- Essensplanung (#486): Jede Menge darf eine eigene Einheit haben, z. B. „3 Bund“ bei einer
-- Zutat in g, „2 Dose“ oder „1 EL“, unabhängig von der Einheitenart der Zutat. Bekannte Einheiten
-- stehen weiter als 'g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund'; eigene als Text bis 20
-- Zeichen. Beschreibung: docs/essensplanung.md („Einheiten“). Rückwärtskompatibel: Die Spalten
-- werden nur breiter und nehmen mehr Werte an.

-- Die Prüfungen auf die festen Einheiten (und die, die die Spalte nennen) fallen weg, damit die
-- Spalten breiter werden können.
ALTER TABLE essen.gericht_zutat DROP CONSTRAINT ck_essen_gericht_zutat_einheit;
ALTER TABLE essen.gericht_zutat DROP CONSTRAINT ck_essen_gericht_zutat_menge_einheit;
ALTER TABLE essen.bestand DROP CONSTRAINT ck_essen_bestand_einheit;
ALTER TABLE essen.zusatzbedarf DROP CONSTRAINT ck_essen_zusatzbedarf_einheit;
ALTER TABLE essen.zusatzbedarf DROP CONSTRAINT ck_essen_zusatzbedarf_menge_einheit;
ALTER TABLE essen.einplanung_verbrauch DROP CONSTRAINT ck_essen_einplanung_verbrauch_einheit;
ALTER TABLE essen.einplanung_verbrauch DROP CONSTRAINT uq_essen_einplanung_verbrauch;
ALTER TABLE essen.einkauf_posten DROP CONSTRAINT ck_essen_einkauf_posten_einheit;
ALTER TABLE essen.einkauf_posten DROP CONSTRAINT uq_essen_einkauf_posten;
ALTER TABLE essen.einkauf_regel DROP CONSTRAINT ck_essen_einkauf_regel_einheit;
ALTER TABLE essen.einkauf_regel DROP CONSTRAINT ck_essen_einkauf_regel_fest;
GO

ALTER TABLE essen.gericht_zutat ALTER COLUMN einheit nvarchar(20) NULL;
ALTER TABLE essen.bestand ALTER COLUMN einheit nvarchar(20) NOT NULL;
ALTER TABLE essen.zusatzbedarf ALTER COLUMN einheit nvarchar(20) NULL;
ALTER TABLE essen.einplanung_verbrauch ALTER COLUMN einheit nvarchar(20) NOT NULL;
ALTER TABLE essen.einkauf_posten ALTER COLUMN einheit nvarchar(20) NOT NULL;
ALTER TABLE essen.einkauf_regel ALTER COLUMN einheit nvarchar(20) NULL;
GO

-- Eine Einheit ist nie leer; Groß- und Kleinschreibung zählt (wie bei der Sortierung der
-- Datenbank) nicht, „Dose“ und „dose“ sind dieselbe Einheit.
ALTER TABLE essen.gericht_zutat ADD
  CONSTRAINT ck_essen_gericht_zutat_einheit CHECK (einheit IS NULL OR einheit <> N''),
  CONSTRAINT ck_essen_gericht_zutat_menge_einheit CHECK (
    (menge IS NULL AND einheit IS NULL) OR (menge IS NOT NULL AND einheit IS NOT NULL)
  );
ALTER TABLE essen.bestand ADD
  CONSTRAINT ck_essen_bestand_einheit CHECK (einheit <> N'');
ALTER TABLE essen.zusatzbedarf ADD
  CONSTRAINT ck_essen_zusatzbedarf_einheit CHECK (einheit IS NULL OR einheit <> N''),
  CONSTRAINT ck_essen_zusatzbedarf_menge_einheit CHECK (
    (menge IS NULL AND einheit IS NULL) OR (menge IS NOT NULL AND einheit IS NOT NULL)
  );
ALTER TABLE essen.einplanung_verbrauch ADD
  CONSTRAINT ck_essen_einplanung_verbrauch_einheit CHECK (einheit <> N''),
  CONSTRAINT uq_essen_einplanung_verbrauch UNIQUE (einplanung_id, planung_zutat_id, einheit);
ALTER TABLE essen.einkauf_posten ADD
  CONSTRAINT ck_essen_einkauf_posten_einheit CHECK (einheit <> N''),
  CONSTRAINT uq_essen_einkauf_posten UNIQUE (einkauf_id, planung_zutat_id, einheit);
ALTER TABLE essen.einkauf_regel ADD
  CONSTRAINT ck_essen_einkauf_regel_einheit CHECK (einheit IS NULL OR einheit <> N''),
  CONSTRAINT ck_essen_einkauf_regel_fest CHECK (
    (art = 'fest' AND menge IS NOT NULL AND einheit IS NOT NULL)
    OR (art <> 'fest' AND menge IS NULL AND einheit IS NULL)
  );
