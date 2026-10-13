ALTER TABLE organisation.task ADD assignment_resolution nvarchar(10) NOT NULL
  CONSTRAINT df_task_assignment_resolution DEFAULT N'legacy'
  CONSTRAINT ck_task_assignment_resolution CHECK (assignment_resolution IN (N'legacy', N'matched', N'declined'));
