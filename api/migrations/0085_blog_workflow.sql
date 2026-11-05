-- Existing publications retain their status; NULL is the legacy baseline.
ALTER TABLE content.blog_post ADD workflow_json nvarchar(max) NULL;
GO
