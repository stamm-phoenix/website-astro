-- Direct loan records replace the unmerged request/approval workflow (#660).
-- Pending requests were never loans: retain their history without reserving inventory.
UPDATE organisation.verleih SET status = 'zurueckgezogen' WHERE status IN ('antrag', 'abgelehnt');
UPDATE organisation.verleih SET status = 'ausgegeben' WHERE status = 'genehmigt';
-- These queued messages belong to the removed approval flow and must not be sent later.
DELETE FROM organisation.verleih_mail WHERE gesendet = 0;
