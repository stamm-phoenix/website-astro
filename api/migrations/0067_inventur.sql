-- Inventur (#107): Stammesmaterial im Leitendenbereich unter „Inventur“. Ein Artikel hat eine
-- oder mehrere Varianten (Größen bei Kleidung, Motive bei Aufnähern); der Bestand steht je
-- Variante. Die Verleihliste (#110) verknüpft Ausleihen später mit Artikel und Variante, die
-- QR-Codes (#152) verweisen auf den Artikel.

CREATE TABLE organisation.inventar_artikel (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_inventar_artikel PRIMARY KEY,
  version     rowversion         NOT NULL,
  bezeichnung nvarchar(200)      NOT NULL
    CONSTRAINT ck_inventar_artikel_bezeichnung CHECK (LEN(bezeichnung) > 0),
  kategorie   varchar(12)        NOT NULL
    CONSTRAINT ck_inventar_artikel_kategorie CHECK (kategorie IN ('kleidung', 'aufnaeher', 'zelt', 'lager')),
  einheit     nvarchar(30)       NOT NULL CONSTRAINT df_inventar_artikel_einheit DEFAULT N'Stück',
  lagerort    nvarchar(100)      NOT NULL CONSTRAINT df_inventar_artikel_lagerort DEFAULT N'',
  zustand     varchar(16)        NOT NULL CONSTRAINT df_inventar_artikel_zustand DEFAULT 'gut'
    CONSTRAINT ck_inventar_artikel_zustand CHECK (zustand IN ('gut', 'gebrauchsspuren', 'reparatur', 'defekt')),
  -- Zubehör (bei Zelten) sowie fehlende oder beschädigte Teile, als Text.
  zubehoer    nvarchar(1000)     NOT NULL CONSTRAINT df_inventar_artikel_zubehoer DEFAULT N'',
  fehlend     nvarchar(1000)     NOT NULL CONSTRAINT df_inventar_artikel_fehlend DEFAULT N'',
  notizen     nvarchar(2000)     NOT NULL CONSTRAINT df_inventar_artikel_notizen DEFAULT N'',
  created_at  datetime2(0)       NOT NULL CONSTRAINT df_inventar_artikel_created_at DEFAULT SYSUTCDATETIME(),
  updated_at  datetime2(0)       NOT NULL CONSTRAINT df_inventar_artikel_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by  nvarchar(254)      NOT NULL
);

CREATE INDEX ix_inventar_artikel_kategorie ON organisation.inventar_artikel (kategorie);

-- Ein Artikel ohne Größen oder Motive hat genau eine Variante mit leerer Bezeichnung.
CREATE TABLE organisation.inventar_variante (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_inventar_variante PRIMARY KEY,
  artikel_id  int                NOT NULL
    CONSTRAINT fk_inventar_variante_artikel REFERENCES organisation.inventar_artikel (id) ON DELETE CASCADE,
  bezeichnung nvarchar(100)      NOT NULL CONSTRAINT df_inventar_variante_bezeichnung DEFAULT N'',
  bestand     int                NOT NULL CONSTRAINT df_inventar_variante_bestand DEFAULT 0
    CONSTRAINT ck_inventar_variante_bestand CHECK (bestand >= 0),
  sortierung  int                NOT NULL CONSTRAINT df_inventar_variante_sortierung DEFAULT 0,
  -- Letzte Bestandszählung: wann und von wem.
  gezaehlt_am  datetime2(0)      NULL,
  gezaehlt_von nvarchar(254)     NULL
);

CREATE INDEX ix_inventar_variante_artikel ON organisation.inventar_variante (artikel_id);
