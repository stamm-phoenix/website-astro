-- Aktionen, Belege und Instagram-Token (#165): ersetzen die letzten SharePoint-Listen
-- „Kalender“, „Belege“ und „InstagramToken“. Wie bei Gruppenstunden und Leitenden
-- (`0024_gruppenstunden_leitende.sql`) überträgt die Website die Einträge beim ersten Zugriff
-- nach dem Deploy selbst (`api/lib/sharepoint-import.ts`), mit ihren IDs; die Listen in
-- SharePoint bleiben unverändert stehen. Die Fotos der Belege liegen im Blob Storage
-- (`belege/<id>/<datei>`), hier steht nur ihr Name.

-- Übernahme und ID-Zähler kennen die neuen Listen und Tabellen.
ALTER TABLE content.sharepoint_import DROP CONSTRAINT ck_sharepoint_import_list;
ALTER TABLE content.sharepoint_import ADD CONSTRAINT ck_sharepoint_import_list
  CHECK (list IN ('gruppenstunden', 'leitende', 'aktionen', 'belege', 'instagram'));

ALTER TABLE content.id_counter DROP CONSTRAINT ck_id_counter_table;
ALTER TABLE content.id_counter ADD CONSTRAINT ck_id_counter_table
  CHECK (table_name IN (
    'content.gruppenstunde', 'content.leitende', 'content.aktion', 'organisation.beleg'
  ));

INSERT INTO content.id_counter (table_name, last_id) VALUES
  ('content.aktion', 0), ('organisation.beleg', 0);
GO

-- ---------------------------------------------------------------------------------------------
-- Aktionen (öffentlicher Kalender)
-- ---------------------------------------------------------------------------------------------

-- Die Stufen, die im Formular zur Auswahl stehen. Die festen kommen aus dem Code; die
-- Übernahme ergänzt die übrigen Auswahlwerte der SharePoint-Spalte „Stufen“.
CREATE TABLE content.aktion_stufe_option (
  name nvarchar(255) NOT NULL CONSTRAINT pk_aktion_stufe_option PRIMARY KEY,
  CONSTRAINT ck_aktion_stufe_option_name CHECK (LEN(name) > 0)
);

INSERT INTO content.aktion_stufe_option (name) VALUES
  (N'Wölflinge'), (N'Jungpfadfinder'), (N'Pfadfinder'), (N'Rover'), (N'Leitende');

CREATE TABLE content.aktion (
  -- Übernommen aus SharePoint oder vergeben von `nextContentId`.
  id          int           NOT NULL CONSTRAINT pk_aktion PRIMARY KEY,
  -- Ändert sich auch mit den Stufen (der Code aktualisiert dann `updated_at`).
  version     rowversion    NOT NULL,
  -- Bei verknüpften Einträgen die Kopie aus CampFlow; die Seite zeigt die Werte aus CampFlow.
  title       nvarchar(255) NOT NULL,
  -- Übernommene Einträge können ohne Datum sein; das Formular verlangt eines.
  start_date  date          NULL,
  end_date    date          NULL,
  link        nvarchar(2000) NOT NULL CONSTRAINT df_aktion_link DEFAULT N'',
  -- Bereinigtes HTML (`sanitizeRichText`).
  description nvarchar(max) NOT NULL CONSTRAINT df_aktion_description DEFAULT N'',
  -- CampFlow-Aktion, aus der der Eintrag stammt; jede höchstens einmal.
  campflow_id varchar(40)   NULL,
  created_at  datetime2(0)  NOT NULL CONSTRAINT df_aktion_created_at DEFAULT SYSUTCDATETIME(),
  updated_at  datetime2(0)  NOT NULL CONSTRAINT df_aktion_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by  nvarchar(254) NOT NULL CONSTRAINT df_aktion_updated_by DEFAULT N''
);

CREATE UNIQUE INDEX uq_aktion_campflow_id ON content.aktion (campflow_id)
  WHERE campflow_id IS NOT NULL;

CREATE TABLE content.aktion_stufe (
  aktion_id int           NOT NULL
    CONSTRAINT fk_aktion_stufe_aktion REFERENCES content.aktion (id) ON DELETE CASCADE,
  stufe     nvarchar(255) NOT NULL
    CONSTRAINT fk_aktion_stufe_option REFERENCES content.aktion_stufe_option (name) ON UPDATE CASCADE,
  CONSTRAINT pk_aktion_stufe PRIMARY KEY (aktion_id, stufe)
);

-- ---------------------------------------------------------------------------------------------
-- Belege
-- ---------------------------------------------------------------------------------------------

CREATE TABLE organisation.beleg (
  -- Übernommen aus SharePoint oder vergeben von `nextContentId`.
  id           int           NOT NULL CONSTRAINT pk_beleg PRIMARY KEY,
  -- Ändert sich auch mit dem Foto und der KI-Prüfung.
  version      rowversion    NOT NULL,
  shop         nvarchar(255) NOT NULL,
  -- Übernommene Belege können ohne Datum sein; das Formular verlangt eines.
  beleg_date   date          NULL,
  amount_cent  int           NOT NULL CONSTRAINT df_beleg_amount_cent DEFAULT 0,
  paid_by      nvarchar(255) NOT NULL CONSTRAINT df_beleg_paid_by DEFAULT N'',
  -- Die Person, die bezahlt hat, will das Geld zurück.
  payout       bit           NOT NULL CONSTRAINT df_beleg_payout DEFAULT 0,
  aktion       nvarchar(255) NOT NULL CONSTRAINT df_beleg_aktion DEFAULT N'',
  note         nvarchar(max) NOT NULL CONSTRAINT df_beleg_note DEFAULT N'',
  status       varchar(12)   NOT NULL
    CONSTRAINT ck_beleg_status CHECK (status IN ('Eingereicht', 'Angenommen', 'Abgelehnt')),
  review_note  nvarchar(max) NOT NULL CONSTRAINT df_beleg_review_note DEFAULT N'',
  -- Login der Person, die den Beleg eingereicht hat.
  submitted_by nvarchar(254) NOT NULL,
  submitted_at datetime2(3)  NOT NULL,
  -- Das Foto (`beleg-<Ziffern>.jpg`, bei einem Scan `beleg-<Ziffern>-scan.jpg` mit dem
  -- unbearbeiteten Foto `…-original.jpg` daneben), oder NULL ohne Foto.
  photo        varchar(60)   NULL
    CONSTRAINT ck_beleg_photo CHECK (
      photo LIKE 'beleg-[0-9]%.jpg' AND (
        SUBSTRING(photo, 7, LEN(photo) - 10) NOT LIKE '%[^0-9]%' OR (
          photo LIKE '%-scan.jpg' AND SUBSTRING(photo, 7, LEN(photo) - 15) NOT LIKE '%[^0-9]%'
        )
      )
    ),
  -- Ergebnis der KI-Vorprüfung (`BelegCheck` als JSON), falls eingerichtet.
  ai_check     nvarchar(max) NULL CONSTRAINT ck_beleg_ai_check CHECK (ISJSON(ai_check) = 1),
  created_at   datetime2(0)  NOT NULL CONSTRAINT df_beleg_created_at DEFAULT SYSUTCDATETIME(),
  updated_at   datetime2(0)  NOT NULL CONSTRAINT df_beleg_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by   nvarchar(254) NOT NULL CONSTRAINT df_beleg_updated_by DEFAULT N'',
  CONSTRAINT ck_beleg_amount CHECK (amount_cent >= 0)
);

CREATE INDEX ix_beleg_submitted_by ON organisation.beleg (submitted_by);

-- ---------------------------------------------------------------------------------------------
-- Instagram
-- ---------------------------------------------------------------------------------------------

-- Das aktuelle Zugriffstoken für Instagram, das die Website wöchentlich erneuert
-- (`api/lib/instagram-token.ts`); höchstens eine Zeile.
CREATE TABLE content.instagram_token (
  id           tinyint        NOT NULL CONSTRAINT pk_instagram_token PRIMARY KEY
    CONSTRAINT ck_instagram_token_id CHECK (id = 1),
  token        nvarchar(2000) NOT NULL CONSTRAINT ck_instagram_token_token CHECK (LEN(token) > 0),
  -- NULL, wenn unbekannt; dann wird beim nächsten Zugriff erneuert.
  refreshed_at datetime2(0)   NULL
);
