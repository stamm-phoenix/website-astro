-- Essensplanung (#452): zentrale Listen und Steuerung. Die Planungen selbst kommen mit späteren
-- Migrationen. Gepflegt wird alles hier im Modul „Essensplanung“ des Leitendenbereichs, nur von
-- den Teams Admin und Vorstand. Beschreibung: docs/essensplanung.md.
CREATE SCHEMA essen;
GO

-- Eine Zeile: Schalter und Vorlagen für neue Planungen.
CREATE TABLE essen.einstellungen (
  id                  tinyint       NOT NULL CONSTRAINT pk_essen_einstellungen PRIMARY KEY
    CONSTRAINT ck_essen_einstellungen_single CHECK (id = 1),
  version             rowversion    NOT NULL,
  -- Externe (Adressen außerhalb von @stamm-phoenix.de) dürfen Planungen anlegen.
  anlegen_extern      bit           NOT NULL,
  -- JSON-Array aus Adressen und Domains; leer: alle Externen, sofern `anlegen_extern`.
  whitelist           nvarchar(max) NOT NULL
    CONSTRAINT ck_essen_einstellungen_whitelist CHECK (ISJSON(whitelist) = 1 AND LEFT(whitelist, 1) = N'['),
  -- Monate nach dem letzten Tag einer Planung, bis sie gelöscht wird.
  aufbewahrung_monate smallint      NOT NULL
    CONSTRAINT ck_essen_einstellungen_aufbewahrung CHECK (aufbewahrung_monate BETWEEN 1 AND 120),
  -- Notschalter: Änderungen an Planungen werden abgelehnt, Lesen geht.
  wartung             bit           NOT NULL,
  -- JSON-Array [{ "name": "Wö", "faktor": 0.7 }, …]: Gruppen einer neuen Planung.
  vorlage_gruppen     nvarchar(max) NOT NULL
    CONSTRAINT ck_essen_einstellungen_gruppen CHECK (ISJSON(vorlage_gruppen) = 1 AND LEFT(vorlage_gruppen, 1) = N'['),
  -- JSON-Array mit den Namen der Mahlzeiten eines neuen Tages.
  vorlage_mahlzeiten  nvarchar(max) NOT NULL
    CONSTRAINT ck_essen_einstellungen_mahlzeiten CHECK (ISJSON(vorlage_mahlzeiten) = 1 AND LEFT(vorlage_mahlzeiten, 1) = N'['),
  updated_at          datetime2(0)  NOT NULL CONSTRAINT df_essen_einstellungen_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by          nvarchar(254) NOT NULL
);

-- Wer wann in der Steuerung etwas geändert hat.
CREATE TABLE essen.audit_log (
  id      int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_audit_log PRIMARY KEY,
  at      datetime2(0)       NOT NULL CONSTRAINT df_essen_audit_log_at DEFAULT SYSUTCDATETIME(),
  actor   nvarchar(254)      NOT NULL,
  action  varchar(40)        NOT NULL,
  -- JSON-Objekt mit den Einzelheiten (Name des Eintrags, geänderte Felder).
  details nvarchar(max)      NOT NULL
    CONSTRAINT ck_essen_audit_log_details CHECK (ISJSON(details) = 1 AND LEFT(details, 1) = N'{')
);

-- Kategorien der Zutaten, wie im Supermarkt (Backware, Gemüse, Reinigung/Hygiene …).
CREATE TABLE essen.kategorie (
  id       int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_kategorie PRIMARY KEY,
  version  rowversion         NOT NULL,
  name     nvarchar(100)      NOT NULL CONSTRAINT uq_essen_kategorie_name UNIQUE
    CONSTRAINT ck_essen_kategorie_name CHECK (LEN(name) > 0)
);

-- Allergene und Unverträglichkeiten. Die 14 EU-Hauptallergene haben einen festen Schlüssel und
-- lassen sich umbenennen, aber nicht löschen; weitere legt die Steuerung an.
CREATE TABLE essen.unvertraeglichkeit (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_unvertraeglichkeit PRIMARY KEY,
  version     rowversion         NOT NULL,
  schluessel  varchar(20)        NULL,
  name        nvarchar(100)      NOT NULL CONSTRAINT uq_essen_unvertraeglichkeit_name UNIQUE
    CONSTRAINT ck_essen_unvertraeglichkeit_name CHECK (LEN(name) > 0)
);
CREATE UNIQUE INDEX uq_essen_unvertraeglichkeit_schluessel ON essen.unvertraeglichkeit (schluessel)
  WHERE schluessel IS NOT NULL;

-- Die zentrale Zutatenliste, auch Nicht-Lebensmittel wie Spülmittel. Planungen dürfen davon
-- abweichen, das gilt dann nur für sie. Geschäfte gibt es hier bewusst nicht, nur pro Planung.
CREATE TABLE essen.zutat (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_zutat PRIMARY KEY,
  version           rowversion         NOT NULL,
  name              nvarchar(150)      NOT NULL CONSTRAINT uq_essen_zutat_name UNIQUE
    CONSTRAINT ck_essen_zutat_name CHECK (LEN(name) > 0),
  kategorie_id      int                NOT NULL
    CONSTRAINT fk_essen_zutat_kategorie REFERENCES essen.kategorie(id),
  -- masse: g/kg, volumen: ml/l; Stück, Packung und Bund werden nur gezählt.
  einheitenart      varchar(8)         NOT NULL
    CONSTRAINT ck_essen_zutat_einheitenart CHECK (einheitenart IN ('masse', 'volumen', 'stueck', 'packung', 'bund')),
  -- Dosen und Gläser: Mengen sind Abtropfgewicht („kg (ATG)“).
  abtropfgewicht    bit                NOT NULL CONSTRAINT df_essen_zutat_abtropfgewicht DEFAULT 0,
  -- 0: Nicht-Lebensmittel; nur für Zusatzbedarf und Bestand, nicht für Gerichte.
  lebensmittel      bit                NOT NULL CONSTRAINT df_essen_zutat_lebensmittel DEFAULT 1,
  -- NULL: unbekannt. Vegan schließt vegetarisch ein.
  vegetarisch       bit                NULL,
  vegan             bit                NULL,
  -- 0: Merkmale und Allergene sind ein ungeprüfter Vorschlag (Startdaten, KI).
  merkmale_geprueft bit                NOT NULL CONSTRAINT df_essen_zutat_merkmale_geprueft DEFAULT 0,
  -- Kurzer Hinweis zu den Merkmalen, z. B. „je nach Produkt mit Gelatine“.
  hinweis           nvarchar(200)      NOT NULL CONSTRAINT df_essen_zutat_hinweis DEFAULT N'',
  -- Umrechnungshilfe der Oberfläche; gespeichert wird nie umgerechnet.
  gramm_pro_tl      decimal(7, 2)      NULL CONSTRAINT ck_essen_zutat_tl CHECK (gramm_pro_tl > 0),
  gramm_pro_el      decimal(7, 2)      NULL CONSTRAINT ck_essen_zutat_el CHECK (gramm_pro_el > 0),
  gramm_pro_stueck  decimal(9, 2)      NULL CONSTRAINT ck_essen_zutat_stueck CHECK (gramm_pro_stueck > 0),
  geaendert_am      datetime2(0)       NOT NULL CONSTRAINT df_essen_zutat_geaendert_am DEFAULT SYSUTCDATETIME(),
  geaendert_von     nvarchar(254)      NOT NULL,
  CONSTRAINT ck_essen_zutat_vegan CHECK (vegan = 0 OR vegan IS NULL OR vegetarisch = 1)
);
CREATE INDEX ix_essen_zutat_kategorie ON essen.zutat (kategorie_id);

-- Welche Allergene und Unverträglichkeiten eine Zutat enthält.
CREATE TABLE essen.zutat_unvertraeglichkeit (
  zutat_id              int NOT NULL
    CONSTRAINT fk_essen_zutat_unvertraeglichkeit_zutat REFERENCES essen.zutat(id) ON DELETE CASCADE,
  unvertraeglichkeit_id int NOT NULL
    CONSTRAINT fk_essen_zutat_unvertraeglichkeit_unvertraeglichkeit
      REFERENCES essen.unvertraeglichkeit(id) ON DELETE CASCADE,
  CONSTRAINT pk_essen_zutat_unvertraeglichkeit PRIMARY KEY (zutat_id, unvertraeglichkeit_id)
);
CREATE INDEX ix_essen_zutat_unvertraeglichkeit ON essen.zutat_unvertraeglichkeit (unvertraeglichkeit_id);
GO

INSERT INTO essen.einstellungen (
  id, anlegen_extern, whitelist, aufbewahrung_monate, wartung, vorlage_gruppen, vorlage_mahlzeiten,
  updated_by
) VALUES (
  1, 0, N'[]', 12, 0,
  N'[{"name":"Wö","faktor":0.7},{"name":"Jupfi","faktor":0.8},{"name":"Pfadi","faktor":1},{"name":"Rover","faktor":1.2},{"name":"Leitende","faktor":1.2}]',
  N'["Frühstück","Mittagessen","Kaffee & Kuchen","Abendessen","Mitternachtssnack"]',
  N'Migration'
);

INSERT INTO essen.unvertraeglichkeit (schluessel, name) VALUES
  ('gluten', N'Gluten'),
  ('krebstiere', N'Krebstiere'),
  ('ei', N'Ei'),
  ('fisch', N'Fisch'),
  ('erdnuesse', N'Erdnüsse'),
  ('soja', N'Soja'),
  ('milch', N'Milch (Laktose)'),
  ('schalenfruechte', N'Schalenfrüchte (Nüsse)'),
  ('sellerie', N'Sellerie'),
  ('senf', N'Senf'),
  ('sesam', N'Sesam'),
  ('sulfite', N'Sulfite'),
  ('lupinen', N'Lupinen'),
  ('weichtiere', N'Weichtiere');
