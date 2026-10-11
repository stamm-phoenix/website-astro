-- Gemeinsame Aufgaben für Projekte, Aktionschecklisten und geprüfte Protokollvorschläge.
CREATE SCHEMA organisation;
GO
CREATE TABLE organisation.project (
 id int IDENTITY NOT NULL CONSTRAINT pk_project PRIMARY KEY,
 version rowversion NOT NULL,
 title nvarchar(200) NOT NULL CONSTRAINT ck_project_title CHECK (LEN(title) > 0),
 campflow_id nvarchar(100) NOT NULL CONSTRAINT df_project_campflow DEFAULT N'',
 updated_by nvarchar(254) NOT NULL
);
CREATE TABLE organisation.template (
 id int IDENTITY NOT NULL CONSTRAINT pk_task_template PRIMARY KEY,
 version rowversion NOT NULL,
 title nvarchar(200) NOT NULL CONSTRAINT ck_task_template_title CHECK (LEN(title) > 0),
 -- JSON: title, description, assignee, daysBefore (bezogen auf das Aktionsdatum).
 items nvarchar(max) NOT NULL CONSTRAINT ck_task_template_items CHECK (ISJSON(items) = 1),
 updated_by nvarchar(254) NOT NULL
);
CREATE TABLE organisation.task (
 id int IDENTITY NOT NULL CONSTRAINT pk_task PRIMARY KEY,
 version rowversion NOT NULL,
 project_id int NULL CONSTRAINT fk_task_project REFERENCES organisation.project(id),
 title nvarchar(200) NOT NULL CONSTRAINT ck_task_title CHECK (LEN(title) > 0),
 description nvarchar(2000) NOT NULL,
 assignee nvarchar(254) NOT NULL,
 due_date date NULL,
 state varchar(12) NOT NULL CONSTRAINT ck_task_state CHECK (state IN ('offen', 'erledigt', 'vorschlag', 'abgelehnt')),
 source_id nvarchar(100) NOT NULL CONSTRAINT df_task_source DEFAULT N'',
 source_version varchar(100) NOT NULL CONSTRAINT df_task_source_version DEFAULT '',
 quote nvarchar(500) NOT NULL CONSTRAINT df_task_quote DEFAULT N'',
 source_key varchar(64) NULL,
 updated_by nvarchar(254) NOT NULL,
 created_at datetime2(0) NOT NULL CONSTRAINT df_task_created DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX uq_task_source ON organisation.task(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX ix_task_state_due ON organisation.task(state, due_date);
-- Eine Vorlage wird je Projekt nur einmal angewendet, auch bei parallelen Klicks.
CREATE TABLE organisation.checklist (
 project_id int NOT NULL CONSTRAINT fk_checklist_project REFERENCES organisation.project(id),
 template_id int NOT NULL CONSTRAINT fk_checklist_template REFERENCES organisation.template(id),
 CONSTRAINT pk_checklist PRIMARY KEY(project_id, template_id)
);
