-- Downloads (#165): ersetzen die Dokumentbibliothek in SharePoint. Die Dateien und ihre
-- Vorschaubilder liegen im Blob Storage (`downloads/<datei_schluessel>/…`, `api/lib/downloads.ts`),
-- hier stehen Name, Größe und Stand. Die Website überträgt die Dateien der Bibliothek nach dem
-- Deploy selbst (`api/lib/download-import.ts`), mit ihren IDs, damit geteilte Links wie
-- `/api/downloads/<id>/file` gültig bleiben; die Bibliothek in SharePoint bleibt unverändert.

ALTER TABLE content.sharepoint_import DROP CONSTRAINT ck_sharepoint_import_list;
ALTER TABLE content.sharepoint_import ADD CONSTRAINT ck_sharepoint_import_list
  CHECK (list IN ('gruppenstunden', 'leitende', 'aktionen', 'belege', 'instagram', 'downloads'));
GO

CREATE TABLE content.download (
  -- Übernommen aus SharePoint (ID des Dokuments) oder zufällig vergeben (`newDownloadId`).
  -- Binär verglichen, weil die zufälligen IDs Groß- und Kleinschreibung unterscheiden.
  id          varchar(64)   COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT pk_download PRIMARY KEY,
  version     rowversion    NOT NULL,
  -- Eindeutig ohne Rücksicht auf Groß- und Kleinschreibung, wie in SharePoint. Übernommene
  -- Namen können länger sein, als das Formular erlaubt; die Länge prüft `pflege-validation.ts`.
  file_name   nvarchar(400) COLLATE Latin1_General_100_CI_AS NOT NULL
    CONSTRAINT ck_download_file_name CHECK (LEN(file_name) > 0),
  -- Ordner der aktuellen Fassung im Blob Storage; jede hochgeladene Fassung bekommt einen neuen.
  file_key    varchar(40)   COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT ck_download_file_key CHECK (file_key NOT LIKE '%[^A-Za-z0-9_-]%' AND LEN(file_key) > 0),
  size        bigint        NOT NULL CONSTRAINT ck_download_size CHECK (size >= 0),
  mime_type   varchar(255)  NOT NULL,
  -- Es gibt Vorschaubilder (`vorschau-klein.jpg`, `vorschau-gross.jpg`) neben der Datei.
  has_preview bit           NOT NULL CONSTRAINT df_download_has_preview DEFAULT 0,
  created_at  datetime2(0)  NOT NULL CONSTRAINT df_download_created_at DEFAULT SYSUTCDATETIME(),
  created_by  nvarchar(254) NOT NULL CONSTRAINT df_download_created_by DEFAULT N'',
  updated_at  datetime2(0)  NOT NULL CONSTRAINT df_download_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by  nvarchar(254) NOT NULL CONSTRAINT df_download_updated_by DEFAULT N''
);

CREATE UNIQUE INDEX uq_download_file_name ON content.download (file_name);
CREATE UNIQUE INDEX uq_download_file_key ON content.download (file_key);
