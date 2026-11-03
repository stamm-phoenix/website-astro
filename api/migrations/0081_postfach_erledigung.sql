-- Modul „E-Mail“: ob eine Konversation erledigt ist oder keinen Handlungsbedarf hat. Ohne Zeile ist
-- sie offen. Kommt nach `am` eine neue Nachricht, zeigt die Seite sie wieder als offen an.
-- Beschreibung: docs/postfaecher.md.

CREATE TABLE postfach.erledigung (
  postfach         varchar(64)   COLLATE Latin1_General_100_BIN2 NOT NULL,
  konversation_id  varchar(256)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  status           varchar(32)   NOT NULL
    CONSTRAINT ck_postfach_erledigung_status CHECK (status IN ('erledigt', 'kein_handlungsbedarf')),
  -- Wer den Stand gesetzt hat.
  login            nvarchar(254) NOT NULL,
  name             nvarchar(200) NOT NULL,
  -- Betreff der Konversation beim Setzen, nur zum Nachsehen.
  betreff          nvarchar(400) NOT NULL CONSTRAINT df_postfach_erledigung_betreff DEFAULT N'',
  am               datetime2(3)  NOT NULL CONSTRAINT df_postfach_erledigung_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_postfach_erledigung PRIMARY KEY (postfach, konversation_id)
);
