-- Essensplanung (#452): Einkäufe einer Planung mit Live-Modus. Ein Einkauf deckt die offenen
-- Mahlzeiten bis zu einer Mahlzeit ab, in einem Geschäft oder in allen; was beim Einkaufen
-- abgehakt wird, steht mit der erhaltenen Menge und einem Ersatzprodukt in essen.einkauf_posten
-- und kommt ins Lager. Die Liste eines Einkaufs rechnet die Seite (docs/essensplanung.md).

CREATE TABLE essen.einkauf (
  id              int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_einkauf PRIMARY KEY,
  version         rowversion     NOT NULL,
  planung_id      int            NOT NULL
    CONSTRAINT fk_essen_einkauf_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  position        smallint       NOT NULL,
  name            nvarchar(80)   NOT NULL CONSTRAINT ck_essen_einkauf_name CHECK (LEN(name) > 0),
  datum           date           NULL,
  -- Ohne Kaskade (zweiter Weg); das Löschen eines Geschäfts setzt es vorher auf NULL.
  -- NULL: alle Geschäfte.
  geschaeft_id    int            NULL
    CONSTRAINT fk_essen_einkauf_geschaeft REFERENCES essen.geschaeft(id),
  -- Ohne Fremdschlüssel wie die Grenzen der Teilnehmenden: Fehlt die Mahlzeit (gelöscht) oder ist
  -- es NULL, deckt der Einkauf alle Mahlzeiten ab.
  bis_mahlzeit_id int            NULL,
  abgeschlossen   bit            NOT NULL CONSTRAINT df_essen_einkauf_abgeschlossen DEFAULT 0
);
CREATE INDEX ix_essen_einkauf_planung ON essen.einkauf (planung_id);
CREATE INDEX ix_essen_einkauf_geschaeft ON essen.einkauf (geschaeft_id)
  WHERE geschaeft_id IS NOT NULL;

-- Was beim Einkaufen abgehakt wurde: je Zutat und Einheit die erhaltene Menge (0 bei Posten ohne
-- Menge oder wenn es nichts gab) und optional ein Ersatzprodukt.
CREATE TABLE essen.einkauf_posten (
  id                        int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_einkauf_posten PRIMARY KEY,
  version                   rowversion      NOT NULL,
  einkauf_id                int             NOT NULL
    CONSTRAINT fk_essen_einkauf_posten_einkauf REFERENCES essen.einkauf(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg): Eine Zutat mit abgehakten Posten lässt sich nicht löschen.
  planung_zutat_id          int             NOT NULL
    CONSTRAINT fk_essen_einkauf_posten_planung_zutat REFERENCES essen.planung_zutat(id),
  einheit                   varchar(7)      NOT NULL
    CONSTRAINT ck_essen_einkauf_posten_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  erhalten                  decimal(12, 3)  NOT NULL CONSTRAINT ck_essen_einkauf_posten_erhalten CHECK (erhalten >= 0),
  ersatz                    nvarchar(100)   NOT NULL CONSTRAINT df_essen_einkauf_posten_ersatz DEFAULT N'',
  -- Ohne Fremdschlüssel: Der Name bleibt lesbar, solange es das Mitglied gibt.
  abgehakt_von_mitglied_id  int             NULL,
  abgehakt_am               datetime2(0)    NOT NULL CONSTRAINT df_essen_einkauf_posten_abgehakt_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uq_essen_einkauf_posten UNIQUE (einkauf_id, planung_zutat_id, einheit)
);
CREATE INDEX ix_essen_einkauf_posten_planung_zutat ON essen.einkauf_posten (planung_zutat_id);

-- Hand-Eingriffe je Einkauf und Zutat: 'ohne' (nicht in diesem Einkauf), 'mit' (in diesem Einkauf,
-- auch wenn die Zutat zu einem anderen Geschäft gehört) und 'fest' (genau diese Menge).
CREATE TABLE essen.einkauf_regel (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_einkauf_regel PRIMARY KEY,
  einkauf_id        int             NOT NULL
    CONSTRAINT fk_essen_einkauf_regel_einkauf REFERENCES essen.einkauf(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg): Eine Zutat mit Regeln lässt sich nicht löschen.
  planung_zutat_id  int             NOT NULL
    CONSTRAINT fk_essen_einkauf_regel_planung_zutat REFERENCES essen.planung_zutat(id),
  art               varchar(4)      NOT NULL
    CONSTRAINT ck_essen_einkauf_regel_art CHECK (art IN ('ohne', 'mit', 'fest')),
  menge             decimal(12, 3)  NULL CONSTRAINT ck_essen_einkauf_regel_menge CHECK (menge >= 0),
  einheit           varchar(7)      NULL
    CONSTRAINT ck_essen_einkauf_regel_einheit CHECK (einheit IN ('g', 'kg', 'ml', 'l', 'stueck', 'packung', 'bund')),
  CONSTRAINT ck_essen_einkauf_regel_fest CHECK (
    (art = 'fest' AND menge IS NOT NULL AND einheit IS NOT NULL)
    OR (art <> 'fest' AND menge IS NULL AND einheit IS NULL)
  ),
  CONSTRAINT uq_essen_einkauf_regel UNIQUE (einkauf_id, planung_zutat_id)
);
CREATE INDEX ix_essen_einkauf_regel_planung_zutat ON essen.einkauf_regel (planung_zutat_id);
