-- NULL-sichere Regeln für die Zahlungsdaten (#317, Codex-Review). Ein CHECK lässt UNKNOWN durch:
-- Mit operation_state NULL ergab z. B. `operation_state = 'created'` UNKNOWN, so dass eine
-- Beitrags-ID, eine Versandbestätigung oder eine Zahlungsmarkierung ohne Vorgang gespeichert
-- werden konnte, und `snapshot_amount BETWEEN …` ließ einen Vorgang ohne Betrag zu. Die neuen
-- Regeln ergeben bei NULL immer TRUE oder FALSE.
ALTER TABLE sammel.payment ADD
  CONSTRAINT ck_sammel_payment_contribution_state CHECK (
    COALESCE(operation_state, '') = 'created'
    OR (contribution_id IS NULL AND contribution_reference IS NULL)),
  CONSTRAINT ck_sammel_payment_dispatch_state CHECK (
    dispatch_confirmed_at IS NULL OR COALESCE(operation_state, '') = 'created'),
  CONSTRAINT ck_sammel_payment_settlement_state CHECK (
    settlement_marked_at IS NULL OR COALESCE(operation_state, '') = 'created'),
  CONSTRAINT ck_sammel_payment_amount CHECK (
    operation_key IS NULL OR snapshot_amount IS NOT NULL);
