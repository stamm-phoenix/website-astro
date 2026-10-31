-- Downloads (#143): ein Thema je Datei, nach dem die öffentliche Seite filtert. Frei gewählter
-- Text wie bei den Themen der FAQ; „Allgemein“ steht für Dateien ohne eigenes Thema.

ALTER TABLE content.download
  ADD category nvarchar(50) NOT NULL
    CONSTRAINT df_download_category DEFAULT N'Allgemein'
    CONSTRAINT ck_download_category CHECK (LEN(category) > 0);
