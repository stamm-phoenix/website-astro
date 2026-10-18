-- Projekte sind kein eigener Datensatz mehr, sondern ein Name an der Aufgabe. Ein Projekt gibt es,
-- solange eine Aufgabe diesen Namen trägt; anlegen, verknüpfen oder löschen entfällt.
-- organisation.project, organisation.checklist und task.project_id bleiben vorerst für den alten
-- Code während des Deployments stehen und werden in einer späteren Migration entfernt.
ALTER TABLE organisation.task ADD project nvarchar(200) NOT NULL
 CONSTRAINT df_task_project DEFAULT N'';
-- Die Vorlage, aus der eine Aufgabe entstanden ist. Eine Vorlage wird je Projekt nur einmal
-- angewendet, solange noch Aufgaben aus ihr im Projekt stehen.
ALTER TABLE organisation.task ADD checklist_template_id int NULL
 CONSTRAINT fk_task_checklist_template REFERENCES organisation.template(id);
GO
UPDATE task SET project = p.title
 FROM organisation.task task
 JOIN organisation.project p ON p.id = task.project_id;
CREATE INDEX ix_task_project ON organisation.task(project);
