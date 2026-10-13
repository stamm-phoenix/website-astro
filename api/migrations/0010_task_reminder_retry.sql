-- Preserve definite failures and defer throttled recipients without blocking later batches.
ALTER TABLE organisation.task_reminder_delivery DROP CONSTRAINT ck_task_reminder_delivery_status;
ALTER TABLE organisation.task_reminder_delivery ADD CONSTRAINT ck_task_reminder_delivery_status
 CHECK (status IN ('attempted', 'sent', 'uncertain', 'failed', 'retryable'));
ALTER TABLE organisation.task_reminder_delivery ADD retry_after datetime2(0) NULL;
