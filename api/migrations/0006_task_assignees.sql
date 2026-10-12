-- Keep the legacy single-person column for compatible clients and existing previews.
ALTER TABLE organisation.task ADD assignees nvarchar(max) NOT NULL
 CONSTRAINT df_task_assignees DEFAULT N'[]' WITH VALUES;
ALTER TABLE organisation.task ADD CONSTRAINT ck_task_assignees CHECK (ISJSON(assignees) = 1);
