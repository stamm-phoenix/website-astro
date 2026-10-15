-- E-Mail-Adressen der Sammelbestellungen exakt vergleichen (#317, Codex-Review). Die
-- Standardsortierung von Azure SQL setzt z. B. „ß“ und „ss“ gleich, so dass
-- familie@straße.de und familie@strasse.de dieselbe Bestellung bekämen. Die Website speichert die
-- Adressen bereits klein geschrieben, deshalb genügt ein binärer Vergleich.
ALTER TABLE sammel.member_order DROP CONSTRAINT uq_sammel_order_email;
ALTER TABLE sammel.member_order
  ALTER COLUMN email nvarchar(254) COLLATE Latin1_General_100_BIN2 NOT NULL;
ALTER TABLE sammel.member_order
  ADD CONSTRAINT uq_sammel_order_email UNIQUE (campaign_id, email);

ALTER TABLE sammel.invitation DROP CONSTRAINT pk_sammel_invitation;
ALTER TABLE sammel.invitation
  ALTER COLUMN address nvarchar(254) COLLATE Latin1_General_100_BIN2 NOT NULL;
ALTER TABLE sammel.invitation
  ADD CONSTRAINT pk_sammel_invitation PRIMARY KEY (campaign_id, address);
