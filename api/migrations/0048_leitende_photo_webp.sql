-- Fotos der Leitenden: neue Fotos werden als WebP gespeichert (`foto-<Ziffern>.webp`), bereits
-- gespeicherte bleiben `foto-<Ziffern>.jpg`; die Regel lässt beides zu.
ALTER TABLE content.leitende DROP CONSTRAINT ck_leitende_photo;
GO
ALTER TABLE content.leitende ADD CONSTRAINT ck_leitende_photo CHECK (
  (photo LIKE 'foto-[0-9]%.jpg' AND SUBSTRING(photo, 6, LEN(photo) - 9) NOT LIKE '%[^0-9]%')
  OR (photo LIKE 'foto-[0-9]%.webp' AND SUBSTRING(photo, 6, LEN(photo) - 10) NOT LIKE '%[^0-9]%')
);
