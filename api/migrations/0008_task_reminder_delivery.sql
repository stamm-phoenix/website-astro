-- One durable attempt per recipient and Berlin calendar day, including ambiguous deliveries.
CREATE TABLE organisation.task_reminder_delivery (
 id int IDENTITY NOT NULL CONSTRAINT pk_task_reminder_delivery PRIMARY KEY,
 version rowversion NOT NULL,
 reminder_day date NOT NULL,
 recipient nvarchar(254) NOT NULL,
 status varchar(12) NOT NULL CONSTRAINT ck_task_reminder_delivery_status
   CHECK (status IN ('attempted', 'sent', 'uncertain')),
 attempted_at datetime2(0) NOT NULL CONSTRAINT df_task_reminder_attempted DEFAULT SYSUTCDATETIME(),
 sent_at datetime2(0) NULL,
 CONSTRAINT uq_task_reminder_day_recipient UNIQUE (reminder_day, recipient)
);
