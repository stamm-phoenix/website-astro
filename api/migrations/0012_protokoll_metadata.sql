-- Files remain in SharePoint. Workflow state and the exact legacy snapshot live in SQL.
CREATE TABLE organisation.protokoll (
  drive_id nvarchar(200) NOT NULL,
  item_id nvarchar(100) NOT NULL,
  fields nvarchar(max) NOT NULL,
  legacy_fields nvarchar(max) NULL,
  legacy_etag nvarchar(400) NULL,
  version rowversion NOT NULL,
  CONSTRAINT pk_protokoll PRIMARY KEY (drive_id, item_id),
  CONSTRAINT ck_protokoll_fields CHECK (ISJSON(fields) = 1),
  CONSTRAINT ck_protokoll_legacy CHECK (legacy_fields IS NULL OR ISJSON(legacy_fields) = 1)
);
CREATE TABLE organisation.protokoll_import (
  drive_id nvarchar(200) NOT NULL PRIMARY KEY,
  completed_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  version rowversion NOT NULL
);
