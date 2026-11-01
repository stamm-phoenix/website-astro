-- Essensplanung (#486): Belege einer Planung. Wer hat was bezahlt, was ist schon erstattet; das
-- Foto (oder PDF) liegt im Blob Storage unter essen-belege/<planung_id>/<foto>. Die Belege
-- verlassen die Planung nur per PDF-Export. Beschreibung: docs/essensplanung.md, Belege.

CREATE TABLE essen.beleg (
  id                        int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_essen_beleg PRIMARY KEY,
  version                   rowversion     NOT NULL,
  planung_id                int            NOT NULL
    CONSTRAINT fk_essen_beleg_planung REFERENCES essen.planung(id) ON DELETE CASCADE,
  datum                     date           NOT NULL,
  betrag_cent               int            NOT NULL
    CONSTRAINT ck_essen_beleg_betrag CHECK (betrag_cent > 0 AND betrag_cent <= 1000000),
  -- Geschäft oder was gekauft wurde, z. B. „Rewe“ oder „Gas für den Kocher“.
  haendler                  nvarchar(100)  NOT NULL CONSTRAINT df_essen_beleg_haendler DEFAULT N'',
  notiz                     nvarchar(500)  NOT NULL CONSTRAINT df_essen_beleg_notiz DEFAULT N'',
  -- Bezahlt hat ein Mitglied der Planung (nie gelöscht, nur entzogen) oder jemand anderes mit
  -- freiem Namen, genau eins von beiden. Ohne Kaskade (zweiter Weg von der Planung her); das
  -- Löschen der Planung entfernt die Belege zuerst.
  bezahlt_von_mitglied_id   int            NULL
    CONSTRAINT fk_essen_beleg_bezahlt_von REFERENCES essen.mitglied(id),
  bezahlt_von_text          nvarchar(100)  NOT NULL CONSTRAINT df_essen_beleg_bezahlt_von_text DEFAULT N'',
  erstattet                 bit            NOT NULL CONSTRAINT df_essen_beleg_erstattet DEFAULT 0,
  erstattet_am              datetime2(0)   NULL,
  erstattet_von_mitglied_id int            NULL
    CONSTRAINT fk_essen_beleg_erstattet_von REFERENCES essen.mitglied(id),
  -- Name der Datei im Ordner der Planung (wie organisation.beleg.photo); NULL ohne Foto.
  foto                      nvarchar(100)  NULL,
  angelegt_von_mitglied_id  int            NULL
    CONSTRAINT fk_essen_beleg_angelegt_von REFERENCES essen.mitglied(id),
  angelegt_am               datetime2(0)   NOT NULL CONSTRAINT df_essen_beleg_angelegt_am DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_essen_beleg_bezahlt_von
    CHECK ((bezahlt_von_mitglied_id IS NULL AND bezahlt_von_text <> N'')
      OR (bezahlt_von_mitglied_id IS NOT NULL AND bezahlt_von_text = N''))
);
GO

CREATE INDEX ix_essen_beleg_planung ON essen.beleg (planung_id);
CREATE INDEX ix_essen_beleg_bezahlt_von ON essen.beleg (bezahlt_von_mitglied_id)
  WHERE bezahlt_von_mitglied_id IS NOT NULL;
