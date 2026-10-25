-- Abstimmungen (Diskussion #410): Termine finden oder über frei eingetragene Optionen abstimmen,
-- wie bei Doodle oder einer WhatsApp-Umfrage. Leitende stimmen im Leitendenbereich ab, alle
-- anderen über einen Link: den gemeinsamen Einladungslink (mit Namenseingabe) oder ihren
-- persönlichen Link aus der Einladungsmail. Beschreibung: docs/abstimmungen.md.
CREATE SCHEMA abstimmung;
GO

CREATE TABLE abstimmung.abstimmung (
  id             int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_abstimmung PRIMARY KEY,
  version        rowversion             NOT NULL,
  titel          nvarchar(200)          NOT NULL CONSTRAINT ck_abstimmung_titel CHECK (LEN(titel) > 0),
  beschreibung   nvarchar(2000)         NOT NULL CONSTRAINT df_abstimmung_beschreibung DEFAULT N'',
  -- 1: mehrere Optionen wählbar (z. B. alle passenden Termine), 0: genau eine.
  mehrfach       bit                    NOT NULL CONSTRAINT df_abstimmung_mehrfach DEFAULT 1,
  -- Geheimer Teil des gemeinsamen Einladungslinks (32 Zufallsbytes, base64url). Binäre
  -- Kollation: Groß- und Kleinschreibung zählen.
  link_token     varchar(43)            COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT uq_abstimmung_link_token UNIQUE,
  -- Login und Name der Person, die die Abstimmung angelegt hat; nur sie verwaltet sie.
  erstellt_von   nvarchar(254)          NOT NULL,
  erstellt_von_name nvarchar(200)       NOT NULL,
  erstellt_am    datetime2(0)           NOT NULL CONSTRAINT df_abstimmung_erstellt_am DEFAULT SYSUTCDATETIME(),
  -- Beendet: Es kann niemand mehr abstimmen, das Ergebnis bleibt sichtbar.
  geschlossen_am datetime2(0)           NULL
);

-- Die Optionen in der Reihenfolge der Abstimmung, z. B. „Sa, 14.11. 18 Uhr“ oder „Pizza“.
CREATE TABLE abstimmung.optionen (
  id             int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_abstimmung_optionen PRIMARY KEY,
  abstimmung_id  int                    NOT NULL
    CONSTRAINT fk_abstimmung_optionen_abstimmung REFERENCES abstimmung.abstimmung(id),
  position       smallint               NOT NULL,
  text           nvarchar(200)          NOT NULL CONSTRAINT ck_abstimmung_optionen_text CHECK (LEN(text) > 0)
);
CREATE INDEX ix_abstimmung_optionen_abstimmung ON abstimmung.optionen (abstimmung_id, position);

-- Eine Zeile je Person, die abstimmt oder eingeladen ist. Leitende im Leitendenbereich haben
-- ihren Login, Eingeladene ihre Adresse; wer über den gemeinsamen Link kommt, nur den Namen.
-- Jede Zeile hat einen persönlichen Link (`token`), mit dem die Person ihre Antwort ändert.
CREATE TABLE abstimmung.teilnahme (
  id             int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_abstimmung_teilnahme PRIMARY KEY,
  abstimmung_id  int                    NOT NULL
    CONSTRAINT fk_abstimmung_teilnahme_abstimmung REFERENCES abstimmung.abstimmung(id),
  token          varchar(43)            COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT uq_abstimmung_teilnahme_token UNIQUE,
  name           nvarchar(200)          NOT NULL CONSTRAINT df_abstimmung_teilnahme_name DEFAULT N'',
  -- Klein geschrieben, wie sie die Website vergleicht.
  login          nvarchar(254)          NULL,
  email          nvarchar(254)          NULL,
  -- Zeitpunkt der letzten Antwort; NULL, solange die Person nicht abgestimmt hat.
  geantwortet_am datetime2(3)           NULL,
  -- Mail an die Adresse: welche Art als Nächstes oder zuletzt, und ihr Stand. „versucht“ ist
  -- vor dem Versand reserviert und wird nie automatisch erneut verschickt.
  mail_art       varchar(10)            NULL
    CONSTRAINT ck_abstimmung_teilnahme_mail_art CHECK (mail_art IN ('einladung', 'erinnerung')),
  mail_status    varchar(9)             NULL
    CONSTRAINT ck_abstimmung_teilnahme_mail_status CHECK (mail_status IN ('offen', 'versucht', 'gesendet')),
  eingeladen_am  datetime2(3)           NULL,
  erinnert_am    datetime2(3)           NULL,
  erstellt_am    datetime2(0)           NOT NULL CONSTRAINT df_abstimmung_teilnahme_erstellt_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_abstimmung_teilnahme_mail CHECK (
    (mail_art IS NULL AND mail_status IS NULL) OR (email IS NOT NULL AND mail_art IS NOT NULL AND mail_status IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_abstimmung_teilnahme_login ON abstimmung.teilnahme (abstimmung_id, login)
  WHERE login IS NOT NULL;
CREATE UNIQUE INDEX uq_abstimmung_teilnahme_email ON abstimmung.teilnahme (abstimmung_id, email)
  WHERE email IS NOT NULL;

-- Die gewählten Optionen einer Person.
CREATE TABLE abstimmung.stimme (
  teilnahme_id   int                    NOT NULL
    CONSTRAINT fk_abstimmung_stimme_teilnahme REFERENCES abstimmung.teilnahme(id),
  option_id      int                    NOT NULL
    CONSTRAINT fk_abstimmung_stimme_option REFERENCES abstimmung.optionen(id),
  CONSTRAINT pk_abstimmung_stimme PRIMARY KEY (teilnahme_id, option_id)
);
CREATE INDEX ix_abstimmung_stimme_option ON abstimmung.stimme (option_id);
