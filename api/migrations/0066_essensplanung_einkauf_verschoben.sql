-- Essensplanung (#452): Eine Regel 'ohne', die beim Verschieben in einen anderen Einkauf entsteht,
-- merkt sich das Ziel. Wird das Ziel gelöscht, fällt nur diese Regel weg; ein von Hand gesetztes
-- „Nicht in diesem Einkauf“ (verschoben_nach NULL) bleibt. Ohne Fremdschlüssel wie bis_mahlzeit_id.
ALTER TABLE essen.einkauf_regel ADD verschoben_nach int NULL;
GO
