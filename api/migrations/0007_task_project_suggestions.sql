-- Projektideen bleiben Teil des Aufgabenvorschlags bis zur ausdrücklichen Annahme.
ALTER TABLE organisation.task ADD suggested_project_title nvarchar(200) NOT NULL
 CONSTRAINT df_task_suggested_project_title DEFAULT N'';
