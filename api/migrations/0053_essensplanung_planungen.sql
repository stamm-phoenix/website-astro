-- Essensplanung (#452), Teil 3: Planungen mit Mitgliedern, Tagen und Mahlzeiten. Zugang nur über
-- Links mit Token, ohne Login. Beschreibung: docs/essensplanung.md.

-- Wer eine Planung anlegen will, bekommt einen Bestätigungslink per Mail; erst damit entsteht
-- sie. Unbestätigte Anfragen verfallen nach 24 Stunden.
CREATE TABLE essen.anlage_anfrage (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_anlage_anfrage PRIMARY KEY,
  -- SHA-256 des Tokens im Bestätigungslink (hex).
  token_hash    char(64)       NOT NULL CONSTRAINT uq_essen_anlage_anfrage_token UNIQUE,
  -- Klein geschrieben.
  email         nvarchar(254)  NOT NULL,
  name          nvarchar(100)  NOT NULL,
  planung_name  nvarchar(150)  NOT NULL,
  erster_tag    date           NOT NULL,
  letzter_tag   date           NOT NULL,
  erstellt_am   datetime2(0)   NOT NULL CONSTRAINT df_essen_anlage_anfrage_erstellt_am DEFAULT SYSUTCDATETIME(),
  laeuft_ab     datetime2(0)   NOT NULL,
  -- Gesetzt, sobald die Planung entstanden ist; die Anfrage bleibt bis zum Aufräumen.
  planung_id    int            NULL,
  CONSTRAINT ck_essen_anlage_anfrage_tage CHECK (letzter_tag >= erster_tag)
);
CREATE INDEX ix_essen_anlage_anfrage_email ON essen.anlage_anfrage (email, erstellt_am);

CREATE TABLE essen.planung (
  id                    int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_planung PRIMARY KEY,
  version               rowversion     NOT NULL,
  name                  nvarchar(150)  NOT NULL CONSTRAINT ck_essen_planung_name CHECK (LEN(name) > 0),
  -- Bearbeitende dürfen Mitglieder einladen und verwalten (sonst nur Besitzer:innen).
  mitglieder_verwalten  bit            NOT NULL CONSTRAINT df_essen_planung_mitglieder_verwalten DEFAULT 0,
  -- Gemeinsame Links zum Beitreten und zum Ansehen; NULL: abgeschaltet. Wie der „Link für alle“
  -- der Abstimmungen im Klartext, damit die Besitzer:in sie jederzeit wieder kopieren kann.
  -- Binäre Kollation: Groß- und Kleinschreibung zählen.
  beitritt_token        varchar(43)    COLLATE Latin1_General_100_BIN2 NULL,
  lese_token            varchar(43)    COLLATE Latin1_General_100_BIN2 NULL,
  -- Zählt jede Änderung; die Seiten fragen danach, ob es Neues gibt.
  aenderung_seq         bigint         NOT NULL CONSTRAINT df_essen_planung_aenderung_seq DEFAULT 0,
  erstellt_am           datetime2(0)   NOT NULL CONSTRAINT df_essen_planung_erstellt_am DEFAULT SYSUTCDATETIME(),
  geaendert_am          datetime2(0)   NOT NULL CONSTRAINT df_essen_planung_geaendert_am DEFAULT SYSUTCDATETIME(),
  -- Warnmail vor dem Löschen nach Ablauf der Aufbewahrung.
  loeschwarnung_am      datetime2(0)   NULL
);
CREATE UNIQUE INDEX uq_essen_planung_beitritt ON essen.planung (beitritt_token) WHERE beitritt_token IS NOT NULL;
CREATE UNIQUE INDEX uq_essen_planung_lese ON essen.planung (lese_token) WHERE lese_token IS NOT NULL;

-- Wer Zugang hat: eigener Link (nur der Hash steht hier), frei gewählter Name.
CREATE TABLE essen.mitglied (
  id               int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_mitglied PRIMARY KEY,
  version          rowversion     NOT NULL,
  planung_id       int            NOT NULL
    CONSTRAINT fk_essen_mitglied_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  name             nvarchar(100)  NOT NULL CONSTRAINT ck_essen_mitglied_name CHECK (LEN(name) > 0),
  -- Klein geschrieben; NULL bei Beitritt ohne Adresse.
  email            nvarchar(254)  NULL,
  rolle            varchar(10)    NOT NULL
    CONSTRAINT ck_essen_mitglied_rolle CHECK (rolle IN ('besitzer', 'bearbeiten')),
  -- SHA-256 des persönlichen Tokens (hex); NULL, sobald der Zugang entzogen ist.
  token_hash       char(64)       NULL,
  erstellt_am      datetime2(0)   NOT NULL CONSTRAINT df_essen_mitglied_erstellt_am DEFAULT SYSUTCDATETIME(),
  zuletzt_da_am    datetime2(0)   NULL,
  -- Letzte Mail mit einem Link an dieses Mitglied (Wartezeit für „Meine Planungen“).
  link_gesendet_am datetime2(0)   NULL,
  -- Der Name bleibt für Zuständigkeiten und Änderungen stehen.
  entzogen_am      datetime2(0)   NULL
);
CREATE UNIQUE INDEX uq_essen_mitglied_token ON essen.mitglied (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX ix_essen_mitglied_planung ON essen.mitglied (planung_id);
CREATE INDEX ix_essen_mitglied_email ON essen.mitglied (email) WHERE email IS NOT NULL;

-- Die Tage einer Planung; Tag 1 ist der früheste.
CREATE TABLE essen.tag (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_tag PRIMARY KEY,
  version     rowversion  NOT NULL,
  planung_id  int         NOT NULL
    CONSTRAINT fk_essen_tag_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  datum       date        NOT NULL,
  CONSTRAINT uq_essen_tag_datum UNIQUE (planung_id, datum)
);

-- Die Mahlzeiten eines Tages in ihrer Reihenfolge; die angezeigte ID `<Tag>_<Position>`
-- entsteht aus der Reihenfolge, nicht aus der id.
CREATE TABLE essen.mahlzeit (
  id        int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_mahlzeit PRIMARY KEY,
  version   rowversion     NOT NULL,
  tag_id    int            NOT NULL
    CONSTRAINT fk_essen_mahlzeit_tag REFERENCES essen.tag(id) ON DELETE CASCADE,
  position  smallint       NOT NULL,
  name      nvarchar(50)   NOT NULL CONSTRAINT ck_essen_mahlzeit_name CHECK (LEN(name) > 0),
  -- Optional, `HH:MM` wie bei den Nikolaus-Tagen.
  uhrzeit   char(5)        NULL
    CONSTRAINT ck_essen_mahlzeit_uhrzeit CHECK (uhrzeit LIKE '[0-2][0-9]:[0-5][0-9]')
);
CREATE INDEX ix_essen_mahlzeit_tag ON essen.mahlzeit (tag_id, position);

-- Jede Änderung einer Planung: Wer hat wann was geändert. Die Seiten fragen nach der höchsten
-- `seq`, um zu sehen, ob es Neues gibt.
CREATE TABLE essen.aenderung (
  id           bigint IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_aenderung PRIMARY KEY,
  planung_id   int            NOT NULL
    CONSTRAINT fk_essen_aenderung_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  seq          bigint         NOT NULL,
  at           datetime2(3)   NOT NULL CONSTRAINT df_essen_aenderung_at DEFAULT SYSUTCDATETIME(),
  mitglied_id  int            NULL,
  -- Z. B. „mahlzeit-geaendert“.
  aktion       varchar(40)    NOT NULL,
  -- JSON-Objekt mit Name und Einzelheiten, für „wer hat was geändert“.
  details      nvarchar(1000) NOT NULL
    CONSTRAINT ck_essen_aenderung_details CHECK (ISJSON(details) = 1 AND LEFT(details, 1) = N'{')
);
CREATE INDEX ix_essen_aenderung_planung ON essen.aenderung (planung_id, seq);
