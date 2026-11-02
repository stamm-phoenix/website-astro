-- Befristete Hinweise lassen die regulären Gruppenstunden unverändert.
ALTER TABLE content.gruppenstunde ADD exception_json nvarchar(max) NULL
  CONSTRAINT ck_gruppenstunde_exception_json CHECK (exception_json IS NULL OR ISJSON(exception_json) = 1);
