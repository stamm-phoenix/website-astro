-- Schnupperstunden-Anfragen (#139): Familien fragen auf /mitmachen eine Schnupperstunde an,
-- Leitende bestätigen im Leitendenbereich einen Termin oder sagen ab. Die Familie bekommt den
-- Stand jeweils per E-Mail. Es gibt keinen Buchungskalender: der Termin ist frei gewählt.
--
-- Die Kontaktdaten bleiben nur so lange, wie die Anfrage gebraucht wird: abgeschlossene Anfragen
-- werden nach Ablauf von CONFIG.schnupper.retention gelöscht.
--
-- Die Vorschau von PR #497 hat die Tabelle schon unter der Nummer 0070 angelegt, deshalb nur,
-- wenn sie fehlt.

IF OBJECT_ID(N'organisation.schnupper_anfrage', N'U') IS NULL
BEGIN
CREATE TABLE organisation.schnupper_anfrage (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_schnupper_anfrage PRIMARY KEY,
  version       rowversion         NOT NULL,
  created_at    datetime2(0)       NOT NULL CONSTRAINT df_schnupper_anfrage_created_at DEFAULT SYSUTCDATETIME(),

  alter_jahre   tinyint            NOT NULL CONSTRAINT ck_schnupper_anfrage_alter CHECK (alter_jahre BETWEEN 5 AND 25),
  stufe         varchar(12)        NOT NULL CONSTRAINT ck_schnupper_anfrage_stufe
    CHECK (stufe IN ('woelflinge', 'jupfis', 'pfadis', 'rover', 'unklar')),
  kind_vorname  nvarchar(60)       NOT NULL CONSTRAINT df_schnupper_anfrage_kind DEFAULT N'',
  kontakt_name  nvarchar(100)      NOT NULL CONSTRAINT ck_schnupper_anfrage_name CHECK (LEN(kontakt_name) > 0),
  email         nvarchar(254)      NOT NULL,
  telefon       nvarchar(40)       NOT NULL CONSTRAINT df_schnupper_anfrage_telefon DEFAULT N'',
  -- Wann die Familie kommen möchte, als Text („nach den Herbstferien“).
  wunschzeit    nvarchar(300)      NOT NULL CONSTRAINT ck_schnupper_anfrage_wunschzeit CHECK (LEN(wunschzeit) > 0),
  nachricht     nvarchar(2000)     NOT NULL CONSTRAINT df_schnupper_anfrage_nachricht DEFAULT N'',

  status        varchar(12)        NOT NULL CONSTRAINT df_schnupper_anfrage_status DEFAULT 'offen'
    CONSTRAINT ck_schnupper_anfrage_status CHECK (status IN ('offen', 'bestaetigt', 'abgesagt')),
  -- Bestätigter Termin in Berliner Ortszeit; nur bei `bestaetigt` gesetzt.
  termin_datum  date               NULL,
  termin_zeit   char(5)            NULL,
  termin_ort    nvarchar(200)      NOT NULL CONSTRAINT df_schnupper_anfrage_ort DEFAULT N'',
  -- Text an die Familie in der letzten Antwort (Bestätigung oder Absage).
  antwort       nvarchar(2000)     NOT NULL CONSTRAINT df_schnupper_anfrage_antwort DEFAULT N'',
  -- Ob die letzte Antwort-Mail an die Familie verschickt wurde.
  antwort_mail  bit                NULL,
  bearbeitet_von nvarchar(254)     NULL,
  bearbeitet_am datetime2(0)       NULL,

  CONSTRAINT ck_schnupper_anfrage_termin CHECK (
    (status = 'bestaetigt' AND termin_datum IS NOT NULL AND termin_zeit IS NOT NULL)
    OR (status <> 'bestaetigt' AND termin_datum IS NULL AND termin_zeit IS NULL)
  )
);

CREATE INDEX ix_schnupper_anfrage_created ON organisation.schnupper_anfrage (created_at);
END;
