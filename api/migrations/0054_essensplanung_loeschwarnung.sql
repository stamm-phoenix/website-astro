-- Essensplanung (#452): Die Warnung vor dem Löschen wird je Besitzer:in vermerkt, damit eine
-- gescheiterte Mail beim nächsten Lauf nachgeholt wird. Sie gilt für ein bestimmtes Löschdatum;
-- verschiebt sich das Datum, wird erneut gewarnt.
ALTER TABLE essen.mitglied ADD loeschwarnung_fuer date NULL;
GO

ALTER TABLE essen.planung DROP COLUMN loeschwarnung_am;
GO
