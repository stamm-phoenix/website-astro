-- Belege: Einnahmebelege und PDFs. Neben Ausgaben lassen sich Einnahmen einreichen (`art`); sie
-- haben keine Auslage und werden in CampFlow mit positivem Betrag gebucht. Statt eines Fotos darf
-- der Beleg ein PDF sein (`beleg-<Ziffern>.pdf`); daneben liegt die erste Seite als Bild
-- (`…-seite.jpg`), das der Browser beim Hochladen zeichnet (docs/belege-campflow.md).

ALTER TABLE organisation.beleg ADD
  art varchar(8) NOT NULL CONSTRAINT df_beleg_art DEFAULT 'Ausgabe'
    CONSTRAINT ck_beleg_art CHECK (art IN ('Ausgabe', 'Einnahme'));
GO

ALTER TABLE organisation.beleg ADD CONSTRAINT ck_beleg_einnahme_payout
  CHECK (art = 'Ausgabe' OR payout = 0);

-- Was an CampFlow ging, auch nach dem Löschen des Belegs.
ALTER TABLE organisation.beleg_campflow ADD
  art varchar(8) NOT NULL CONSTRAINT df_beleg_campflow_art DEFAULT 'Ausgabe'
    CONSTRAINT ck_beleg_campflow_art CHECK (art IN ('Ausgabe', 'Einnahme'));

ALTER TABLE organisation.beleg DROP CONSTRAINT ck_beleg_photo;
ALTER TABLE organisation.beleg ADD CONSTRAINT ck_beleg_photo CHECK (
  (
    photo LIKE 'beleg-[0-9]%.jpg' AND (
      SUBSTRING(photo, 7, LEN(photo) - 10) NOT LIKE '%[^0-9]%' OR (
        photo LIKE '%-scan.jpg' AND SUBSTRING(photo, 7, LEN(photo) - 15) NOT LIKE '%[^0-9]%'
      )
    )
  ) OR (
    photo LIKE 'beleg-[0-9]%.pdf' AND SUBSTRING(photo, 7, LEN(photo) - 10) NOT LIKE '%[^0-9]%'
  )
);
