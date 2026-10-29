-- Essensplanung (#452): Nach jeder Mahlzeit wird abgehakt, ob ein eingeplantes Gericht gekocht
-- oder ausgelassen wurde, und was es tatsächlich verbraucht hat. Daraus entsteht das Lager.
-- Beschreibung: docs/essensplanung.md.

-- offen: zählt zum Bedarf; gekocht: hat verbraucht, was in essen.einplanung_verbrauch steht;
-- ausgelassen: braucht nichts mehr und verbraucht nichts.
ALTER TABLE essen.einplanung ADD status varchar(11) NOT NULL
  CONSTRAINT df_essen_einplanung_status DEFAULT 'offen'
  CONSTRAINT ck_essen_einplanung_status CHECK (status IN ('offen', 'gekocht', 'ausgelassen'));
GO

-- Was ein gekochtes Gericht tatsächlich verbraucht hat, je Zutat und Einheit (Standard: geplant,
-- 0 für „nicht verwendet“). Wird beim Abhaken als Ganzes ersetzt.
CREATE TABLE essen.einplanung_verbrauch (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_einplanung_verbrauch PRIMARY KEY,
  einplanung_id     int             NOT NULL
    CONSTRAINT fk_essen_einplanung_verbrauch_einplanung REFERENCES essen.einplanung(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg): Eine Zutat mit Verbrauch lässt sich nicht löschen.
  planung_zutat_id  int             NOT NULL
    CONSTRAINT fk_essen_einplanung_verbrauch_planung_zutat REFERENCES essen.planung_zutat(id),
  menge             decimal(12, 3)  NOT NULL CONSTRAINT ck_essen_einplanung_verbrauch_menge CHECK (menge >= 0),
  einheit           varchar(7)      NOT NULL
    CONSTRAINT ck_essen_einplanung_verbrauch_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  CONSTRAINT uq_essen_einplanung_verbrauch UNIQUE (einplanung_id, planung_zutat_id, einheit)
);
CREATE INDEX ix_essen_einplanung_verbrauch_planung_zutat ON essen.einplanung_verbrauch (planung_zutat_id);
