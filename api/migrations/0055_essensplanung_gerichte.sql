-- Essensplanung (#452): Zutaten einer Planung und Gerichte mit Zutatenzeilen.
-- Beschreibung: docs/essensplanung.md.

-- Jede in einer Planung genutzte Zutat: ein Verweis auf die zentrale Liste (mit Abweichungen,
-- die nur hier gelten) oder eine eigene Zutat der Planung. Später hängen hier auch das Geschäft
-- und die Mengen der Einkaufsliste.
CREATE TABLE essen.planung_zutat (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_planung_zutat PRIMARY KEY,
  version       rowversion     NOT NULL,
  planung_id    int            NOT NULL
    CONSTRAINT fk_essen_planung_zutat_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  -- NULL: eigene Zutat der Planung. Eine genutzte zentrale Zutat lässt sich nicht löschen.
  zutat_id      int            NULL
    CONSTRAINT fk_essen_planung_zutat_zutat REFERENCES essen.zutat(id),
  -- Nur bei eigenen Zutaten; zentrale behalten ihren Namen.
  name          nvarchar(150)  NULL CONSTRAINT ck_essen_planung_zutat_name CHECK (LEN(name) > 0),
  -- Bei zentralen Zutaten die Abweichung (NULL: wie in der Liste), bei eigenen Pflicht.
  kategorie_id  int            NULL
    CONSTRAINT fk_essen_planung_zutat_kategorie REFERENCES essen.kategorie(id),
  einheitenart  varchar(8)     NULL
    CONSTRAINT ck_essen_planung_zutat_einheitenart CHECK (einheitenart IN ('masse', 'volumen', 'stueck', 'packung', 'bund')),
  -- Nur bei eigenen Zutaten (NULL: unbekannt), wie in essen.zutat.
  vegetarisch   bit            NULL,
  vegan         bit            NULL,
  CONSTRAINT ck_essen_planung_zutat_art CHECK (
    (zutat_id IS NULL AND name IS NOT NULL AND kategorie_id IS NOT NULL AND einheitenart IS NOT NULL)
    OR (zutat_id IS NOT NULL AND name IS NULL AND vegetarisch IS NULL AND vegan IS NULL)
  ),
  CONSTRAINT ck_essen_planung_zutat_vegan CHECK (vegan = 0 OR vegan IS NULL OR vegetarisch = 1)
);
CREATE UNIQUE INDEX uq_essen_planung_zutat_zutat ON essen.planung_zutat (planung_id, zutat_id)
  WHERE zutat_id IS NOT NULL;
CREATE UNIQUE INDEX uq_essen_planung_zutat_name ON essen.planung_zutat (planung_id, name)
  WHERE name IS NOT NULL;
CREATE INDEX ix_essen_planung_zutat_zutat ON essen.planung_zutat (zutat_id) WHERE zutat_id IS NOT NULL;

-- Allergene und Unverträglichkeiten eigener Zutaten (zentrale haben essen.zutat_unvertraeglichkeit).
CREATE TABLE essen.planung_zutat_unvertraeglichkeit (
  planung_zutat_id      int NOT NULL
    CONSTRAINT fk_essen_pzu_planung_zutat REFERENCES essen.planung_zutat(id) ON DELETE CASCADE,
  unvertraeglichkeit_id int NOT NULL
    CONSTRAINT fk_essen_pzu_unvertraeglichkeit REFERENCES essen.unvertraeglichkeit(id),
  CONSTRAINT pk_essen_planung_zutat_unvertraeglichkeit PRIMARY KEY (planung_zutat_id, unvertraeglichkeit_id)
);
CREATE INDEX ix_essen_pzu_unvertraeglichkeit ON essen.planung_zutat_unvertraeglichkeit (unvertraeglichkeit_id);

-- Ein Rezept der Planung. Werkzeuge und Links stehen als JSON am Gericht, weil sie nur mit dem
-- Gericht zusammen bearbeitet werden.
CREATE TABLE essen.gericht (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_gericht PRIMARY KEY,
  version     rowversion     NOT NULL,
  planung_id  int            NOT NULL
    CONSTRAINT fk_essen_gericht_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  name        nvarchar(150)  NOT NULL CONSTRAINT ck_essen_gericht_name CHECK (LEN(name) > 0),
  -- Für so viele Personen gelten die Mengen der Zutatenzeilen.
  personen    smallint       NOT NULL CONSTRAINT ck_essen_gericht_personen CHECK (personen BETWEEN 1 AND 2000),
  anleitung   nvarchar(max)  NOT NULL CONSTRAINT df_essen_gericht_anleitung DEFAULT N'',
  notiz       nvarchar(1000) NOT NULL CONSTRAINT df_essen_gericht_notiz DEFAULT N'',
  -- JSON-Array [{ "titel": "…", "url": "https://…" }, …].
  links       nvarchar(max)  NOT NULL CONSTRAINT df_essen_gericht_links DEFAULT N'[]'
    CONSTRAINT ck_essen_gericht_links CHECK (ISJSON(links) = 1 AND LEFT(links, 1) = N'['),
  -- JSON-Array mit den Namen der Werkzeuge, z. B. ["Pürierstab"]; Grundlage der Packliste.
  werkzeuge   nvarchar(max)  NOT NULL CONSTRAINT df_essen_gericht_werkzeuge DEFAULT N'[]'
    CONSTRAINT ck_essen_gericht_werkzeuge CHECK (ISJSON(werkzeuge) = 1 AND LEFT(werkzeuge, 1) = N'['),
  CONSTRAINT uq_essen_gericht_name UNIQUE (planung_id, name)
);

-- Die Zutatenzeilen eines Gerichts in ihrer Reihenfolge.
CREATE TABLE essen.gericht_zutat (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_gericht_zutat PRIMARY KEY,
  version           rowversion     NOT NULL,
  gericht_id        int            NOT NULL
    CONSTRAINT fk_essen_gericht_zutat_gericht REFERENCES essen.gericht(id) ON DELETE CASCADE,
  position          smallint       NOT NULL,
  -- Ohne Kaskade: Die Planung erreicht die Zeile schon über das Gericht. Eine genutzte Zutat
  -- der Planung lässt sich nicht löschen.
  planung_zutat_id  int            NOT NULL
    CONSTRAINT fk_essen_gericht_zutat_planung_zutat REFERENCES essen.planung_zutat(id),
  -- NULL: ohne Menge, z. B. Gewürze nach Augenmaß.
  menge             decimal(12, 3) NULL CONSTRAINT ck_essen_gericht_zutat_menge CHECK (menge > 0),
  einheit           varchar(7)     NULL
    CONSTRAINT ck_essen_gericht_zutat_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  -- 1: Gesamtmenge je Einplanung, skaliert weder mit den Essern noch mit dem Faktor.
  fest              bit            NOT NULL CONSTRAINT df_essen_gericht_zutat_fest DEFAULT 0,
  -- Für wen die Zeile gilt.
  fuer_alles        bit            NOT NULL,
  fuer_vegetarisch  bit            NOT NULL,
  fuer_vegan        bit            NOT NULL,
  -- Z. B. „eine Prise“ oder „nach Geschmack“.
  hinweis           nvarchar(100)  NOT NULL CONSTRAINT df_essen_gericht_zutat_hinweis DEFAULT N'',
  CONSTRAINT ck_essen_gericht_zutat_menge_einheit CHECK ((menge IS NULL AND einheit IS NULL) OR (menge IS NOT NULL AND einheit IS NOT NULL)),
  CONSTRAINT ck_essen_gericht_zutat_fuer CHECK (fuer_alles = 1 OR fuer_vegetarisch = 1 OR fuer_vegan = 1)
);
CREATE INDEX ix_essen_gericht_zutat_gericht ON essen.gericht_zutat (gericht_id, position);
CREATE INDEX ix_essen_gericht_zutat_planung_zutat ON essen.gericht_zutat (planung_zutat_id);

-- Unverträglichkeiten einer Zeile: „nicht für …“ (nur = 0) oder bei Ersatzzeilen „nur für …“
-- (nur = 1). Eine genutzte Unverträglichkeit lässt sich in der Steuerung nicht löschen.
CREATE TABLE essen.gericht_zutat_unvertraeglichkeit (
  gericht_zutat_id      int NOT NULL
    CONSTRAINT fk_essen_gzu_gericht_zutat REFERENCES essen.gericht_zutat(id) ON DELETE CASCADE,
  unvertraeglichkeit_id int NOT NULL
    CONSTRAINT fk_essen_gzu_unvertraeglichkeit REFERENCES essen.unvertraeglichkeit(id),
  nur                   bit NOT NULL,
  CONSTRAINT pk_essen_gericht_zutat_unvertraeglichkeit PRIMARY KEY (gericht_zutat_id, unvertraeglichkeit_id)
);
CREATE INDEX ix_essen_gzu_unvertraeglichkeit ON essen.gericht_zutat_unvertraeglichkeit (unvertraeglichkeit_id);
