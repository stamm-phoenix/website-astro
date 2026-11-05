-- Older blog reviews require renewed review rather than assuming unchanged content.
ALTER TABLE content.review ADD source_hash binary(32) NULL;
