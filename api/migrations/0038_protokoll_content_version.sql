-- Inhaltsversionen der Protokolldateien in SharePoint, damit die Liste der Protokolle nach einem
-- Neustart der API nicht jede Datei mit gespeicherter Freigabe- oder Terminversion neu herunterlädt
-- (`api/lib/protokoll-content-version.ts`). Ein Eintrag gilt nur, solange der cTag der Datei
-- gleich ist; ändert sich die Datei, wird sie wieder heruntergeladen und der Eintrag ersetzt.
-- Eine eigene Tabelle statt Spalten in `organisation.protokoll`: deren rowversion ist das ETag
-- des Workflows und darf sich beim Lesen der Liste nicht ändern.

CREATE TABLE organisation.protokoll_content_version (
  drive_id        nvarchar(200) NOT NULL,
  item_id         nvarchar(100) NOT NULL,
  -- cTag der Datei, aus der die Version berechnet wurde. Binäre Kollation: Verglichen wird
  -- Zeichen für Zeichen wie im Code.
  ctag            nvarchar(400) COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- Fingerabdruck des Inhalts, z. B. docx-word-sha256:… oder file-sha256:….
  content_version varchar(100)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  updated_at      datetime2(0)  NOT NULL
    CONSTRAINT df_protokoll_content_version_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_protokoll_content_version PRIMARY KEY (drive_id, item_id)
);
