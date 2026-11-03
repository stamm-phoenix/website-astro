-- Modul „E-Mail“ im Leitendenbereich: Zuständigkeiten für Konversationen der Gruppenpostfächer
-- und der Lesestand jeder Person. Die Mails selbst bleiben in Exchange und werden über Microsoft
-- Graph gelesen; hier liegen nur IDs und, zum Nachsehen, der Betreff.
-- Beschreibung: docs/postfaecher.md.

CREATE SCHEMA postfach;
GO

-- Wer für eine Konversation zuständig ist. Eine Zeile pro Konversation; ohne Zeile ist niemand zuständig.
CREATE TABLE postfach.zustaendigkeit (
  -- ID des Postfachs aus `api/lib/postfach-liste.ts`, z. B. kontakt.
  postfach         varchar(64)   COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- `conversationId` von Exchange (Base64, Groß- und Kleinschreibung zählt).
  konversation_id  varchar(256)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- Login (Adresse des Microsoft-Kontos) und Name der zuständigen Person.
  login            nvarchar(254) NOT NULL,
  name             nvarchar(200) NOT NULL,
  -- Wer die Person eingetragen hat.
  von_login        nvarchar(254) NOT NULL,
  von_name         nvarchar(200) NOT NULL,
  -- Betreff der Konversation beim Zuweisen, nur zum Nachsehen.
  betreff          nvarchar(400) NOT NULL CONSTRAINT df_postfach_zustaendigkeit_betreff DEFAULT N'',
  am               datetime2(0)  NOT NULL CONSTRAINT df_postfach_zustaendigkeit_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_postfach_zustaendigkeit PRIMARY KEY (postfach, konversation_id)
);
GO

CREATE INDEX ix_postfach_zustaendigkeit_login ON postfach.zustaendigkeit (login);
GO

-- Welche Nachrichten eine Person im Leitendenbereich als gelesen oder ungelesen markiert hat (nicht
-- der Gelesen-Status in Outlook). Eine Markierung gilt vor `postfach.leser.gelesen_bis`.
CREATE TABLE postfach.gelesen (
  postfach      varchar(64)   COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- Benutzer-ID, die Static Web Apps nach der Anmeldung übergibt (`userId` des Principals).
  user_id       varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- Unveränderliche ID der Nachricht in Exchange (ImmutableId); bleibt beim Verschieben gleich.
  nachricht_id  varchar(256)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- 0: ausdrücklich als ungelesen markiert.
  gelesen       bit           NOT NULL CONSTRAINT df_postfach_gelesen_gelesen DEFAULT 1,
  am            datetime2(0)  NOT NULL CONSTRAINT df_postfach_gelesen_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_postfach_gelesen PRIMARY KEY (postfach, user_id, nachricht_id)
);
GO

CREATE INDEX ix_postfach_gelesen_am ON postfach.gelesen (am);
GO

-- Lesestand einer Person je Postfach: Alles, was bis `gelesen_bis` ankam, gilt als gelesen. Die
-- Zeile entsteht beim ersten Öffnen (ein paar Tage zurück), „Alle als gelesen markieren“ setzt sie
-- auf jetzt.
CREATE TABLE postfach.leser (
  postfach     varchar(64)   COLLATE Latin1_General_100_BIN2 NOT NULL,
  user_id      varchar(128)  COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- Login, nur zum Nachsehen, z. B. wenn jemand den Stamm verlässt.
  login        nvarchar(254) NOT NULL,
  gelesen_bis  datetime2(0)  NOT NULL,
  CONSTRAINT pk_postfach_leser PRIMARY KEY (postfach, user_id)
);
