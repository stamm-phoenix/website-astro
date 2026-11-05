CREATE TABLE content.review (
  kind varchar(20) NOT NULL,
  content_id nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  source_version binary(8) NOT NULL,
  reviewed_at datetime2(3) NOT NULL,
  reviewed_by nvarchar(320) NOT NULL,
  blog_id int NULL REFERENCES content.blog_post(id) ON DELETE CASCADE,
  faq_id int NULL REFERENCES content.faq(id) ON DELETE CASCADE,
  gruppenstunde_id int NULL REFERENCES content.gruppenstunde(id) ON DELETE CASCADE,
  leitende_id int NULL REFERENCES content.leitende(id) ON DELETE CASCADE,
  aktion_id int NULL REFERENCES content.aktion(id) ON DELETE CASCADE,
  download_id varchar(64) COLLATE Latin1_General_100_BIN2 NULL REFERENCES content.download(id) ON DELETE CASCADE,
  CONSTRAINT ck_review_reference CHECK (
    (kind = 'blog' AND content_id = CAST(blog_id AS nvarchar(128)) AND blog_id IS NOT NULL AND faq_id IS NULL AND gruppenstunde_id IS NULL AND leitende_id IS NULL AND aktion_id IS NULL AND download_id IS NULL) OR
    (kind = 'faq' AND content_id = CAST(faq_id AS nvarchar(128)) AND faq_id IS NOT NULL AND blog_id IS NULL AND gruppenstunde_id IS NULL AND leitende_id IS NULL AND aktion_id IS NULL AND download_id IS NULL) OR
    (kind = 'gruppenstunde' AND content_id = CAST(gruppenstunde_id AS nvarchar(128)) AND gruppenstunde_id IS NOT NULL AND blog_id IS NULL AND faq_id IS NULL AND leitende_id IS NULL AND aktion_id IS NULL AND download_id IS NULL) OR
    (kind = 'leitende' AND content_id = CAST(leitende_id AS nvarchar(128)) AND leitende_id IS NOT NULL AND blog_id IS NULL AND faq_id IS NULL AND gruppenstunde_id IS NULL AND aktion_id IS NULL AND download_id IS NULL) OR
    (kind = 'aktion' AND content_id = CAST(aktion_id AS nvarchar(128)) AND aktion_id IS NOT NULL AND blog_id IS NULL AND faq_id IS NULL AND gruppenstunde_id IS NULL AND leitende_id IS NULL AND download_id IS NULL) OR
    (kind = 'download' AND content_id = download_id AND download_id IS NOT NULL AND blog_id IS NULL AND faq_id IS NULL AND gruppenstunde_id IS NULL AND leitende_id IS NULL AND aktion_id IS NULL)
  ),
  CONSTRAINT pk_content_review PRIMARY KEY (kind, content_id),
  CONSTRAINT ck_content_review_kind CHECK (kind IN ('blog', 'faq', 'gruppenstunde', 'leitende', 'aktion', 'download'))
);
