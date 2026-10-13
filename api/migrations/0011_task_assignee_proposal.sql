ALTER TABLE organisation.task ADD suggested_assignee_name nvarchar(254) NOT NULL
 CONSTRAINT df_task_suggested_assignee_name DEFAULT N'';
