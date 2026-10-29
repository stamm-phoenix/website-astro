-- Essensplanung (#452): Gruppen und Teilnehmende einer Planung, wer an welcher Mahlzeit isst.
-- Beschreibung: docs/essensplanung.md.

-- Die Gruppen einer Planung mit ihrem Faktor (Wö 0,7, Rover 1,2 …), aus der Vorlage der Steuerung
-- vorbelegt und je Planung frei änderbar.
CREATE TABLE essen.planung_gruppe (
  id          int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_planung_gruppe PRIMARY KEY,
  version     rowversion     NOT NULL,
  planung_id  int            NOT NULL
    CONSTRAINT fk_essen_planung_gruppe_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  position    smallint       NOT NULL,
  name        nvarchar(50)   NOT NULL CONSTRAINT ck_essen_planung_gruppe_name CHECK (LEN(name) > 0),
  faktor      decimal(4, 2)  NOT NULL CONSTRAINT ck_essen_planung_gruppe_faktor CHECK (faktor BETWEEN 0.01 AND 5),
  CONSTRAINT uq_essen_planung_gruppe_name UNIQUE (planung_id, name)
);

-- Eine Zeile der Teilnehmenden: so viele Personen einer Gruppe mit einer Ernährungsform und
-- ihren Unverträglichkeiten, anwesend von einer Mahlzeit bis zu einer Mahlzeit.
CREATE TABLE essen.teilnehmende (
  id               int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_teilnehmende PRIMARY KEY,
  version          rowversion     NOT NULL,
  planung_id       int            NOT NULL
    CONSTRAINT fk_essen_teilnehmende_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  -- Ohne Kaskade: Eine Gruppe mit Teilnehmenden lässt sich nicht löschen.
  gruppe_id        int            NOT NULL
    CONSTRAINT fk_essen_teilnehmende_gruppe REFERENCES essen.planung_gruppe(id),
  ernaehrung       varchar(11)    NOT NULL
    CONSTRAINT ck_essen_teilnehmende_ernaehrung CHECK (ernaehrung IN ('alles', 'vegetarisch', 'vegan')),
  anzahl           smallint       NOT NULL CONSTRAINT ck_essen_teilnehmende_anzahl CHECK (anzahl BETWEEN 1 AND 2000),
  -- NULL: ab der ersten bzw. bis zur letzten Mahlzeit. Ohne Fremdschlüssel (zweiter Kaskadenweg);
  -- wird eine Mahlzeit gelöscht, rücken die Grenzen auf die nächste verbleibende.
  von_mahlzeit_id  int            NULL,
  bis_mahlzeit_id  int            NULL,
  hinweis          nvarchar(200)  NOT NULL CONSTRAINT df_essen_teilnehmende_hinweis DEFAULT N''
);
CREATE INDEX ix_essen_teilnehmende_planung ON essen.teilnehmende (planung_id);
CREATE INDEX ix_essen_teilnehmende_gruppe ON essen.teilnehmende (gruppe_id);

CREATE TABLE essen.teilnehmende_unvertraeglichkeit (
  teilnehmende_id        int NOT NULL
    CONSTRAINT fk_essen_tu_teilnehmende REFERENCES essen.teilnehmende(id) ON DELETE CASCADE,
  unvertraeglichkeit_id  int NOT NULL
    CONSTRAINT fk_essen_tu_unvertraeglichkeit REFERENCES essen.unvertraeglichkeit(id),
  CONSTRAINT pk_essen_teilnehmende_unvertraeglichkeit PRIMARY KEY (teilnehmende_id, unvertraeglichkeit_id)
);
CREATE INDEX ix_essen_tu_unvertraeglichkeit ON essen.teilnehmende_unvertraeglichkeit (unvertraeglichkeit_id);

-- Gruppen, die an einer Mahlzeit nicht mitessen („nur Leitende“ beim Aufbau, „ohne Rover“ ab
-- 6_4). Ohne Eintrag essen alle Gruppen mit; eine neue Gruppe isst überall mit.
CREATE TABLE essen.mahlzeit_ohne_gruppe (
  mahlzeit_id  int NOT NULL
    CONSTRAINT fk_essen_mog_mahlzeit REFERENCES essen.mahlzeit(id) ON DELETE CASCADE,
  -- Ohne Kaskade (zweiter Weg); das Löschen der Gruppe entfernt ihre Einträge zuerst.
  gruppe_id    int NOT NULL
    CONSTRAINT fk_essen_mog_gruppe REFERENCES essen.planung_gruppe(id),
  CONSTRAINT pk_essen_mahlzeit_ohne_gruppe PRIMARY KEY (mahlzeit_id, gruppe_id)
);
CREATE INDEX ix_essen_mog_gruppe ON essen.mahlzeit_ohne_gruppe (gruppe_id);

-- Bestehende Planungen bekommen die Gruppen der Vorlage, wie neue beim Anlegen.
INSERT INTO essen.planung_gruppe (planung_id, position, name, faktor)
SELECT p.id, CAST(j.[key] AS smallint) + 1, g.name, g.faktor
FROM essen.planung AS p
CROSS JOIN essen.einstellungen AS e
CROSS APPLY OPENJSON(e.vorlage_gruppen) AS j
CROSS APPLY OPENJSON(j.value) WITH (name nvarchar(50) '$.name', faktor decimal(4, 2) '$.faktor') AS g
WHERE e.id = 1;
