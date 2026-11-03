-- Essensplanung: Wann ein Mitglied seine Planung zum ersten Mal geöffnet hat. Die Startseite des
-- Leitendenbereichs zeigt Planungen, zu denen jemand eingeladen wurde und die er noch nie
-- geöffnet hat, als Einladung. Eine eigene Tabelle statt einer Spalte am Mitglied, damit das
-- Öffnen keine Version eines Mitglieds ändert, die gerade jemand bearbeitet.
-- Beschreibung: docs/essensplanung.md (Zugang aus dem Leitendenbereich).

CREATE TABLE essen.mitglied_geoeffnet (
  mitglied_id  int           NOT NULL CONSTRAINT pk_essen_mitglied_geoeffnet PRIMARY KEY
    CONSTRAINT fk_essen_mitglied_geoeffnet_mitglied REFERENCES essen.mitglied(id) ON DELETE CASCADE,
  am           datetime2(0)  NOT NULL CONSTRAINT df_essen_mitglied_geoeffnet_am DEFAULT SYSUTCDATETIME()
);
GO

-- Wer schon Mitglied ist, gilt als gesehen: sonst stünden alle bisherigen Planungen als Einladung da.
INSERT INTO essen.mitglied_geoeffnet (mitglied_id, am)
SELECT id, erstellt_am FROM essen.mitglied;
