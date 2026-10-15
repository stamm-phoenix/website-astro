-- Gruppenstunden und Leitende (#165): ersetzen die SharePoint-Listen „Gruppenstunden“ und
-- „Leitende“. Die Website überträgt deren Einträge beim ersten Zugriff nach dem Deploy selbst
-- (`api/lib/sharepoint-import.ts`) und vermerkt das in `content.sharepoint_import`; die IDs der
-- Listeneinträge bleiben erhalten, damit Links wie `/api/leitende/<id>/image` gültig bleiben.
-- Die Fotos der Leitenden liegen im Blob Storage (`leitende/<id>/<foto>`), hier steht nur ihr
-- Name. Die Listen in SharePoint bleiben unverändert stehen.
--
-- Die IDs vergibt der Code (`content-ids.ts`), nicht IDENTITY: Die Übernahme schreibt die IDs aus
-- SharePoint, und `SET IDENTITY_INSERT` dürfte die Website mit ihren Rechten (nur Lesen und
-- Schreiben von Daten) nicht ausführen.
--
-- Übernommene Texte können länger sein, als das Formular erlaubt (SharePoint: 255 Zeichen);
-- die Spalten nehmen sie deshalb vollständig auf, die Längen prüft `pflege-validation.ts`.

-- ---------------------------------------------------------------------------------------------
-- Gruppenstunden
-- ---------------------------------------------------------------------------------------------

CREATE TABLE content.gruppenstunde (
  id           int                NOT NULL CONSTRAINT pk_gruppenstunde PRIMARY KEY,
  version      rowversion         NOT NULL,
  -- Eine der vier Stufen (`STUFEN`); verbindet die Gruppenstunde mit dem Team der Leitenden.
  stufe        nvarchar(255)      NOT NULL,
  weekday      nvarchar(255)      NOT NULL,
  meeting_time nvarchar(255)      NOT NULL,
  age_range    nvarchar(255)      NOT NULL,
  location     nvarchar(255)      NOT NULL,
  -- Bereinigtes HTML (`sanitizeRichText`).
  description  nvarchar(max)      NOT NULL,
  created_at   datetime2(0)       NOT NULL CONSTRAINT df_gruppenstunde_created_at DEFAULT SYSUTCDATETIME(),
  updated_at   datetime2(0)       NOT NULL CONSTRAINT df_gruppenstunde_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by   nvarchar(254)      NOT NULL CONSTRAINT df_gruppenstunde_updated_by DEFAULT N''
);

-- ---------------------------------------------------------------------------------------------
-- Leitende
-- ---------------------------------------------------------------------------------------------

-- Die Teams, die im Formular zur Auswahl stehen. Die festen kommen aus dem Code; die Übernahme
-- ergänzt die übrigen Auswahlwerte der SharePoint-Spalte „Team“.
CREATE TABLE content.team (
  name nvarchar(255) NOT NULL CONSTRAINT pk_team PRIMARY KEY,
  CONSTRAINT ck_team_name CHECK (LEN(name) > 0)
);

INSERT INTO content.team (name) VALUES
  (N'Vorstand'), (N'Wölflinge'), (N'Jungpfadfinder'), (N'Pfadfinder'), (N'Rover');

CREATE TABLE content.leitende (
  id          int                NOT NULL CONSTRAINT pk_leitende PRIMARY KEY,
  -- Ändert sich auch mit dem Foto und den Teams (der Code aktualisiert dann `updated_at`).
  version     rowversion         NOT NULL,
  name        nvarchar(255)      NOT NULL,
  -- Kontaktangaben nur beim Vorstand, sonst leer (`validateLeitende`).
  phone       nvarchar(255)      NOT NULL CONSTRAINT df_leitende_phone DEFAULT N'',
  street      nvarchar(255)      NOT NULL CONSTRAINT df_leitende_street DEFAULT N'',
  postal_code nvarchar(255)      NOT NULL CONSTRAINT df_leitende_postal_code DEFAULT N'',
  city        nvarchar(255)      NOT NULL CONSTRAINT df_leitende_city DEFAULT N'',
  -- Name wie beim Hochladen vergeben (`foto-<Zeitstempel><Zufallszahl>.jpg`), Teil des Blob-Namens.
  photo       varchar(40)        NULL
    CONSTRAINT ck_leitende_photo CHECK (
      photo LIKE 'foto-[0-9]%.jpg' AND SUBSTRING(photo, 6, LEN(photo) - 9) NOT LIKE '%[^0-9]%'
    ),
  created_at  datetime2(0)       NOT NULL CONSTRAINT df_leitende_created_at DEFAULT SYSUTCDATETIME(),
  updated_at  datetime2(0)       NOT NULL CONSTRAINT df_leitende_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by  nvarchar(254)      NOT NULL CONSTRAINT df_leitende_updated_by DEFAULT N''
);

CREATE TABLE content.leitende_team (
  leitende_id int           NOT NULL
    CONSTRAINT fk_leitende_team_leitende REFERENCES content.leitende (id) ON DELETE CASCADE,
  team        nvarchar(255) NOT NULL
    CONSTRAINT fk_leitende_team_team REFERENCES content.team (name) ON UPDATE CASCADE,
  CONSTRAINT pk_leitende_team PRIMARY KEY (leitende_id, team)
);

CREATE INDEX ix_leitende_team_team ON content.leitende_team (team);

-- ---------------------------------------------------------------------------------------------
-- Übernahme aus SharePoint
-- ---------------------------------------------------------------------------------------------

-- Eine Zeile je übernommener Liste. Fehlt sie, überträgt die Website die Liste beim nächsten
-- Zugriff; Previews bekommen sie mit ihren erfundenen Testdaten.
CREATE TABLE content.sharepoint_import (
  list        varchar(20)  NOT NULL CONSTRAINT pk_sharepoint_import PRIMARY KEY
    CONSTRAINT ck_sharepoint_import_list CHECK (list IN ('gruppenstunden', 'leitende')),
  imported_at datetime2(0) NOT NULL CONSTRAINT df_sharepoint_import_imported_at DEFAULT SYSUTCDATETIME(),
  -- Anzahlen zur Prüfung (JSON), z. B. {"items":12,"photos":9,"missingPhotos":[]}.
  summary     nvarchar(max) NOT NULL
);
