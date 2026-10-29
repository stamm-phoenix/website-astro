-- Essensplanung (#452): Geschäfte, Anfangsbestand und Zusatzbedarf einer Planung, aus denen mit
-- dem Bedarf der Gerichte die Einkaufsliste entsteht. Beschreibung: docs/essensplanung.md.

-- Die Geschäfte einer Planung (nie zentral), z. B. „Metro“ oder „Bäckerei am Platz“.
CREATE TABLE essen.geschaeft (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_geschaeft PRIMARY KEY,
  version     rowversion     NOT NULL,
  planung_id  int            NOT NULL
    CONSTRAINT fk_essen_geschaeft_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  position    smallint       NOT NULL,
  name        nvarchar(80)   NOT NULL CONSTRAINT ck_essen_geschaeft_name CHECK (LEN(name) > 0),
  CONSTRAINT uq_essen_geschaeft_name UNIQUE (planung_id, name)
);

-- Wo eine Zutat der Planung gekauft wird. Ohne Kaskade (zweiter Weg); das Löschen eines Geschäfts
-- setzt die Zuordnung zuerst zurück.
ALTER TABLE essen.planung_zutat ADD geschaeft_id int NULL
  CONSTRAINT fk_essen_planung_zutat_geschaeft REFERENCES essen.geschaeft(id);
GO

CREATE INDEX ix_essen_planung_zutat_geschaeft ON essen.planung_zutat (geschaeft_id)
  WHERE geschaeft_id IS NOT NULL;

-- Was vor der Aktion schon da ist (Lager des Stammes); wird von der Einkaufsliste abgezogen.
CREATE TABLE essen.bestand (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_bestand PRIMARY KEY,
  version           rowversion      NOT NULL,
  planung_id        int             NOT NULL
    CONSTRAINT fk_essen_bestand_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg): Eine Zutat mit Bestand lässt sich nicht löschen.
  planung_zutat_id  int             NOT NULL
    CONSTRAINT fk_essen_bestand_planung_zutat REFERENCES essen.planung_zutat(id),
  menge             decimal(12, 3)  NOT NULL CONSTRAINT ck_essen_bestand_menge CHECK (menge > 0),
  einheit           varchar(7)      NOT NULL
    CONSTRAINT ck_essen_bestand_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  hinweis           nvarchar(200)   NOT NULL CONSTRAINT df_essen_bestand_hinweis DEFAULT N''
);
CREATE INDEX ix_essen_bestand_planung ON essen.bestand (planung_id);
CREATE INDEX ix_essen_bestand_planung_zutat ON essen.bestand (planung_zutat_id);

-- Was ohne Gericht gebraucht wird, z. B. Spülmittel oder Gummibärchen für den Abschlussabend.
CREATE TABLE essen.zusatzbedarf (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_zusatzbedarf PRIMARY KEY,
  version           rowversion      NOT NULL,
  planung_id        int             NOT NULL
    CONSTRAINT fk_essen_zusatzbedarf_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg): Eine Zutat mit Zusatzbedarf lässt sich nicht löschen.
  planung_zutat_id  int             NOT NULL
    CONSTRAINT fk_essen_zusatzbedarf_planung_zutat REFERENCES essen.planung_zutat(id),
  menge             decimal(12, 3)  NOT NULL CONSTRAINT ck_essen_zusatzbedarf_menge CHECK (menge > 0),
  einheit           varchar(7)      NOT NULL
    CONSTRAINT ck_essen_zusatzbedarf_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  hinweis           nvarchar(200)   NOT NULL CONSTRAINT df_essen_zusatzbedarf_hinweis DEFAULT N''
);
CREATE INDEX ix_essen_zusatzbedarf_planung ON essen.zusatzbedarf (planung_id);
CREATE INDEX ix_essen_zusatzbedarf_planung_zutat ON essen.zusatzbedarf (planung_zutat_id);
