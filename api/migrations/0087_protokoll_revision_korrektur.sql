-- Korrekturvorschläge (#553): vor dem Übernehmen eines Vorschlags wird die gespeicherte Fassung
-- als Version mit dem Grund „korrektur“ behalten, damit sie sich über „Versionen“ zurückholen lässt.
ALTER TABLE protokoll.revision DROP CONSTRAINT ck_protokoll_revision_reason;
GO
ALTER TABLE protokoll.revision ADD CONSTRAINT ck_protokoll_revision_reason
  CHECK (reason IN ('speichern', 'uebernahme', 'ueberschreiben', 'wiederherstellen', 'korrektur'));
GO
