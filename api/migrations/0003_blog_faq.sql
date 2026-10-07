-- Blog und Fragen & Antworten (#165): ersetzen die SharePoint-Listen „Blog“ und
-- „Fragen & Antworten“. Beide waren in der Produktion leer, es gibt keine Datenübernahme.
-- Die Bilder der Beiträge liegen im Blob Storage (`api/lib/blob-storage.ts`), hier stehen nur
-- ihre Angaben.
--
-- Öffentliche Inhalte, die im Leitendenbereich gepflegt werden, kommen ins Schema `content`.

CREATE SCHEMA content;
GO

-- ---------------------------------------------------------------------------------------------
-- Fragen & Antworten
-- ---------------------------------------------------------------------------------------------

CREATE TABLE content.faq (
  id         int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_faq PRIMARY KEY,
  version    rowversion         NOT NULL,
  question   nvarchar(255)      NOT NULL CONSTRAINT ck_faq_question CHECK (LEN(question) > 0),
  -- Bereinigtes HTML (`sanitizeRichText`); leer nur bei Entwürfen.
  answer     nvarchar(max)      NOT NULL,
  -- Freitext; das Formular schlägt die vorhandenen Themen vor.
  category   nvarchar(100)      NOT NULL CONSTRAINT ck_faq_category CHECK (LEN(category) > 0),
  published  bit                NOT NULL,
  created_at datetime2(0)       NOT NULL CONSTRAINT df_faq_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(0)       NOT NULL CONSTRAINT df_faq_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by nvarchar(254)      NOT NULL CONSTRAINT df_faq_updated_by DEFAULT N'',
  CONSTRAINT ck_faq_published_answer CHECK (published = 0 OR LEN(answer) > 0)
);

-- ---------------------------------------------------------------------------------------------
-- Blog
-- ---------------------------------------------------------------------------------------------

CREATE TABLE content.blog_post (
  id         int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_blog_post PRIMARY KEY,
  -- Ändert sich auch, wenn sich die Bilder ändern (der Code aktualisiert dann `updated_at`).
  version    rowversion         NOT NULL,
  title      nvarchar(255)      NOT NULL CONSTRAINT ck_blog_post_title CHECK (LEN(title) > 0),
  post_date  date               NOT NULL,
  published  bit                NOT NULL,
  -- Kanonisches HTML mit `<img data-bild="…">`-Platzhaltern (`sanitizeBlogHtml`).
  content    nvarchar(max)      NOT NULL,
  created_at datetime2(0)       NOT NULL CONSTRAINT df_blog_post_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(0)       NOT NULL CONSTRAINT df_blog_post_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by nvarchar(254)      NOT NULL CONSTRAINT df_blog_post_updated_by DEFAULT N''
);

CREATE INDEX ix_blog_post_date ON content.blog_post (post_date DESC, id DESC);

-- Die Bilder eines Beitrags; das erste (position 0) ist das Titelbild.
CREATE TABLE content.blog_image (
  post_id  int          NOT NULL
    CONSTRAINT fk_blog_image_post REFERENCES content.blog_post (id) ON DELETE CASCADE,
  -- Name wie beim Hochladen vergeben (`bild-<Zeitstempel>.jpg`), Teil des Blob-Namens.
  [file]   varchar(40)  NOT NULL
    CONSTRAINT ck_blog_image_file CHECK (
      [file] LIKE 'bild-[0-9]%.jpg' AND SUBSTRING([file], 6, LEN([file]) - 9) NOT LIKE '%[^0-9]%'
    ),
  position smallint     NOT NULL CONSTRAINT ck_blog_image_position CHECK (position BETWEEN 0 AND 29),
  alt      nvarchar(300) NOT NULL CONSTRAINT df_blog_image_alt DEFAULT N'',
  width    smallint     NOT NULL CONSTRAINT ck_blog_image_width CHECK (width BETWEEN 1 AND 10000),
  height   smallint     NOT NULL CONSTRAINT ck_blog_image_height CHECK (height BETWEEN 1 AND 10000),
  CONSTRAINT pk_blog_image PRIMARY KEY (post_id, [file]),
  CONSTRAINT uq_blog_image_position UNIQUE (post_id, position)
);
