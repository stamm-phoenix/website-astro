-- Personen statt „Weitere Personen“: Die Liste aus 0018 verknüpft jetzt auch die Leitenden mit
-- ihrer Person in CampFlow, damit Module die angemeldete Person in CampFlow erkennen, statt
-- Namen zu vergleichen (z. B. „(ich)“ in Teilnehmendenlisten). Die Leitenden selbst kommen
-- weiter aus der Entra-Gruppe; eine Zeile mit der Gruppe `leitende` hält nur ihre Verknüpfung
-- und braucht deshalb einen Login. Gepflegt im Leitendenbereich unter „Personen“, siehe
-- docs/personen.md.

ALTER TABLE organisation.person DROP CONSTRAINT ck_person_gruppe;
ALTER TABLE organisation.person ADD CONSTRAINT ck_person_gruppe
  CHECK (gruppe IN ('leitende', 'altleitende', 'weitere'));
ALTER TABLE organisation.person ADD CONSTRAINT ck_person_leitende_login
  CHECK (gruppe <> 'leitende' OR login <> N'');

-- ID der Person in der CampFlow-Mitgliederliste (`per_…`), sonst leer. Anmeldungen zu Events
-- sind in CampFlow eigene Personen mit eigener ID; siehe docs/personen.md.
-- Binäre Kollation wie bei `content.aktion.campflow_id`: CampFlow unterscheidet Groß- und
-- Kleinschreibung, `per_AbC` und `per_abc` sind verschiedene Personen.
ALTER TABLE organisation.person ADD campflow_person_id varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL
  CONSTRAINT df_person_campflow_person_id DEFAULT ''
  CONSTRAINT ck_person_campflow_person_id
    CHECK (campflow_person_id = '' OR campflow_person_id LIKE 'per[_]_%');
GO

-- Ein Konto und eine CampFlow-Person gehören zu höchstens einer Zeile.
CREATE UNIQUE INDEX uq_person_login ON organisation.person (login) WHERE login <> N'';
CREATE UNIQUE INDEX uq_person_campflow_person_id ON organisation.person (campflow_person_id)
  WHERE campflow_person_id <> '';
