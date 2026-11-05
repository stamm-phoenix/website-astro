ALTER TABLE content.aktion ADD
  meeting_point nvarchar(500) NOT NULL CONSTRAINT df_aktion_meeting_point DEFAULT N'',
  packing_list nvarchar(max) NOT NULL CONSTRAINT df_aktion_packing_list DEFAULT N'[]',
  CONSTRAINT ck_aktion_packing_list CHECK (ISJSON(packing_list) = 1);
GO

CREATE TABLE content.aktion_download (
  aktion_id int NOT NULL
    CONSTRAINT fk_aktion_download_aktion REFERENCES content.aktion (id) ON DELETE CASCADE,
  download_id varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT fk_aktion_download_download REFERENCES content.download (id) ON DELETE CASCADE,
  sort_order int NOT NULL CONSTRAINT df_aktion_download_sort_order DEFAULT 0,
  CONSTRAINT pk_aktion_download PRIMARY KEY (aktion_id, download_id)
);
GO
