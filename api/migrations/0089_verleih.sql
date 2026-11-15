-- Verleihanträge, Rückgaben und wiederholbarer Mailversand (#477, #658).
CREATE TABLE organisation.verleih (
 id int IDENTITY PRIMARY KEY,
 version rowversion NOT NULL,
 anfrage_id uniqueidentifier NOT NULL DEFAULT NEWID() UNIQUE,
 anfrage_hash char(64) NOT NULL DEFAULT '',
 status varchar(20) NOT NULL CONSTRAINT ck_verleih_status CHECK (status IN ('antrag','genehmigt','ausgegeben','abgeschlossen','abgelehnt','zurueckgezogen')),
 antragsteller nvarchar(254) NOT NULL,
 entleiher nvarchar(200) NOT NULL,
 kontakt nvarchar(254) NOT NULL,
 verantwortlich nvarchar(200) NOT NULL,
 von char(10) NOT NULL,
 bis char(10) NOT NULL,
 notizen nvarchar(2000) NOT NULL,
 entscheidung nvarchar(2000) NOT NULL DEFAULT N'',
 entschieden_von nvarchar(254) NOT NULL DEFAULT N'',
 CONSTRAINT ck_verleih_zeit CHECK (von <= bis)
);
CREATE TABLE organisation.verleih_position (
 id int IDENTITY PRIMARY KEY,
 verleih_id int NOT NULL REFERENCES organisation.verleih(id),
 variante_id int NOT NULL REFERENCES organisation.inventar_variante(id),
 bezeichnung nvarchar(350) NOT NULL,
 menge int NOT NULL CHECK (menge > 0),
 zurueck int NOT NULL DEFAULT 0,
 CONSTRAINT ck_verleih_rueckgabe CHECK (zurueck >= 0 AND zurueck <= menge),
 CONSTRAINT uq_verleih_variante UNIQUE (verleih_id, variante_id)
);
CREATE INDEX ix_verleih_position_variante ON organisation.verleih_position(variante_id);
CREATE TABLE organisation.verleih_verlauf (
 id int IDENTITY PRIMARY KEY,
 verleih_id int NOT NULL REFERENCES organisation.verleih(id),
 am datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 von nvarchar(254) NOT NULL,
 text nvarchar(4000) NOT NULL
);
CREATE TABLE organisation.verleih_mail (
 id int IDENTITY PRIMARY KEY,
 verleih_id int NOT NULL REFERENCES organisation.verleih(id),
 empfaenger nvarchar(254) NOT NULL,
 betreff nvarchar(250) NOT NULL,
 text nvarchar(4000) NOT NULL,
 gesendet bit NOT NULL DEFAULT 0
);
CREATE TABLE organisation.verleih_einstellung (
 id int NOT NULL PRIMARY KEY CHECK (id = 1),
 version rowversion NOT NULL,
 materialwart nvarchar(254) NOT NULL DEFAULT N''
);
INSERT INTO organisation.verleih_einstellung (id) VALUES (1);
