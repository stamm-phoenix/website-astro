-- The first deployment is closed until the operator verifies the current source.
CREATE TABLE organisation.protokoll_cutover (
  id int NOT NULL PRIMARY KEY CHECK (id = 1),
  mode nvarchar(10) NOT NULL CHECK (mode IN ('frozen', 'sql')),
  sql_started bit NOT NULL DEFAULT 0
);
INSERT INTO organisation.protokoll_cutover (id, mode) VALUES (1, 'frozen');
ALTER TABLE organisation.protokoll ADD imported_fields nvarchar(max) NULL;
GO
ALTER TABLE organisation.protokoll ADD CONSTRAINT ck_protokoll_imported CHECK (imported_fields IS NULL OR ISJSON(imported_fields) = 1);
-- Previously prepared imports have never been served by the SQL implementation.
UPDATE organisation.protokoll SET imported_fields = fields WHERE legacy_fields IS NOT NULL;
ALTER TABLE organisation.protokoll ADD source_cleared bit NOT NULL DEFAULT 0;
