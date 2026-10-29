-- Essensplanung (#452): Auf die Einkaufsliste kommt auch, was nicht in der Zutatenliste steht und
-- keine Menge braucht, z. B. „Kochhandschuhe“. Beschreibung: docs/essensplanung.md.

-- Zusatzbedarf ohne Menge: Menge und Einheit gibt es nur zusammen.
ALTER TABLE essen.zusatzbedarf DROP CONSTRAINT ck_essen_zusatzbedarf_menge;
ALTER TABLE essen.zusatzbedarf DROP CONSTRAINT ck_essen_zusatzbedarf_einheit;
ALTER TABLE essen.zusatzbedarf ALTER COLUMN menge decimal(12, 3) NULL;
ALTER TABLE essen.zusatzbedarf ALTER COLUMN einheit varchar(7) NULL;
GO

ALTER TABLE essen.zusatzbedarf ADD
  CONSTRAINT ck_essen_zusatzbedarf_menge CHECK (menge IS NULL OR menge > 0),
  CONSTRAINT ck_essen_zusatzbedarf_einheit
    CHECK (einheit IS NULL OR einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  CONSTRAINT ck_essen_zusatzbedarf_menge_einheit CHECK (
    (menge IS NULL AND einheit IS NULL) OR (menge IS NOT NULL AND einheit IS NOT NULL)
  );

-- Ob eine eigene Zutat ein Lebensmittel ist; was frei auf die Einkaufsliste kommt, ist keins und
-- taucht deshalb nicht in den Zeilen der Gerichte auf. Zentrale Zutaten nehmen den Wert der Liste.
ALTER TABLE essen.planung_zutat ADD lebensmittel bit NOT NULL
  CONSTRAINT df_essen_planung_zutat_lebensmittel DEFAULT 1;
