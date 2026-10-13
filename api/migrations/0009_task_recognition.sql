-- Persist completed versions even when extraction yielded no actionable tasks.
CREATE TABLE organisation.task_recognition (
 source_id nvarchar(100) NOT NULL,
 source_version varchar(100) NOT NULL,
 processed_at datetime2(0) NOT NULL CONSTRAINT df_task_recognition_processed DEFAULT SYSUTCDATETIME(),
 CONSTRAINT pk_task_recognition PRIMARY KEY (source_id, source_version)
);
-- Preserve decisions from recognition before this journal existed.
INSERT INTO organisation.task_recognition (source_id, source_version)
SELECT DISTINCT source_id, source_version FROM organisation.task WHERE source_id <> N'';
