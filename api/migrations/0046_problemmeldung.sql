-- Problemmeldungen (#270): Besuchende melden Fehler der Website („Problem melden“), Leitende
-- sichten die Meldungen und geben sie an GitHub weiter. Ein Issue entsteht erst nach manueller
-- Freigabe; die KI bewertet nur und schreibt den Entwurf (docs/problemmeldungen.md).
--
-- Gespeichert werden nur bereinigte technische Angaben: Pfade ohne Query und Fragment, keine
-- Tokens, Cookies oder Fehlertexte. Der Rückkontakt bleibt in dieser Tabelle und gelangt nie
-- nach GitHub; er wird gelöscht, sobald die Meldung verworfen oder weitergegeben ist.

CREATE SCHEMA problem;
GO

CREATE TABLE problem.meldung (
  id                 int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_problem_meldung PRIMARY KEY,
  version            rowversion         NOT NULL,
  created_at         datetime2(0)       NOT NULL CONSTRAINT df_problem_meldung_created_at DEFAULT SYSUTCDATETIME(),

  -- Wo die Person das Formular geöffnet hat: Footer oder Fehleranzeige.
  entry              nvarchar(10)       NOT NULL,
  description        nvarchar(4000)     NOT NULL CONSTRAINT ck_problem_meldung_description CHECK (LEN(description) > 0),
  steps              nvarchar(2000)     NOT NULL CONSTRAINT df_problem_meldung_steps DEFAULT N'',
  expected           nvarchar(1000)     NOT NULL CONSTRAINT df_problem_meldung_expected DEFAULT N'',
  -- Freiwillig; wird nicht an GitHub übernommen.
  contact            nvarchar(254)      NOT NULL CONSTRAINT df_problem_meldung_contact DEFAULT N'',

  -- Bereinigter Kontext (api/lib/problemmeldung-model.ts).
  page               nvarchar(200)      NOT NULL CONSTRAINT df_problem_meldung_page DEFAULT N'',
  module             nvarchar(60)       NOT NULL CONSTRAINT df_problem_meldung_module DEFAULT N'',
  error_code         nvarchar(60)       NOT NULL CONSTRAINT df_problem_meldung_error_code DEFAULT N'',
  http_status        smallint           NULL,
  action             nvarchar(200)      NOT NULL CONSTRAINT df_problem_meldung_action DEFAULT N'',
  correlation_id     nvarchar(100)      NOT NULL CONSTRAINT df_problem_meldung_correlation DEFAULT N'',
  app_version        nvarchar(40)       NOT NULL CONSTRAINT df_problem_meldung_app_version DEFAULT N'',
  environment        nvarchar(10)       NOT NULL,
  browser            nvarchar(80)       NOT NULL CONSTRAINT df_problem_meldung_browser DEFAULT N'',
  viewport           nvarchar(12)       NOT NULL CONSTRAINT df_problem_meldung_viewport DEFAULT N'',

  status             nvarchar(20)       NOT NULL CONSTRAINT df_problem_meldung_status DEFAULT N'neu',

  -- KI-Einschätzung: `ai_status` sagt, ob sie vorliegt; `ai_started_at` hält eine laufende Anfrage
  -- fest, damit nicht zwei gleichzeitig laufen.
  ai_status          nvarchar(20)       NOT NULL CONSTRAINT df_problem_meldung_ai_status DEFAULT N'offen',
  ai_verdict         nvarchar(10)       NULL,
  ai_reason          nvarchar(500)      NOT NULL CONSTRAINT df_problem_meldung_ai_reason DEFAULT N'',
  ai_error           nvarchar(200)      NOT NULL CONSTRAINT df_problem_meldung_ai_error DEFAULT N'',
  ai_started_at      datetime2(0)       NULL,
  ai_at              datetime2(0)       NULL,

  -- Der Issue-Entwurf: zuerst von der KI, danach von den Leitenden bearbeitet.
  draft_title        nvarchar(200)      NOT NULL CONSTRAINT df_problem_meldung_draft_title DEFAULT N'',
  draft_body         nvarchar(max)      NOT NULL CONSTRAINT df_problem_meldung_draft_body DEFAULT N'',
  github_label       nvarchar(30)       NOT NULL CONSTRAINT df_problem_meldung_label DEFAULT N'bug',

  -- Sichtung.
  reviewed_by        nvarchar(254)      NOT NULL CONSTRAINT df_problem_meldung_reviewed_by DEFAULT N'',
  reviewed_at        datetime2(0)       NULL,
  discard_reason     nvarchar(500)      NOT NULL CONSTRAINT df_problem_meldung_discard DEFAULT N'',

  -- Übermittlung: `github_started_at` hält fest, dass jemand gerade sendet (oder dass ein
  -- Versuch unklar endete); die Nummer macht aus der Meldung genau ein Issue.
  github_started_at  datetime2(0)       NULL,
  github_number      int                NULL,
  github_url         nvarchar(300)      NOT NULL CONSTRAINT df_problem_meldung_github_url DEFAULT N'',
  github_at          datetime2(0)       NULL,

  CONSTRAINT ck_problem_meldung_entry       CHECK (entry IN (N'footer', N'fehler')),
  CONSTRAINT ck_problem_meldung_environment CHECK (environment IN (N'produktion', N'vorschau')),
  CONSTRAINT ck_problem_meldung_status      CHECK (status IN (N'neu', N'in_pruefung', N'verworfen', N'uebermittelt')),
  CONSTRAINT ck_problem_meldung_ai_status   CHECK (ai_status IN (N'offen', N'laeuft', N'fertig', N'fehler', N'nicht_eingerichtet')),
  CONSTRAINT ck_problem_meldung_ai_verdict  CHECK (ai_verdict IS NULL OR ai_verdict IN (N'spam', N'plausibel', N'unklar')),
  -- Genau die weitergegebenen Meldungen haben ein Issue.
  CONSTRAINT ck_problem_meldung_sent        CHECK (
    (status = N'uebermittelt' AND github_number IS NOT NULL)
    OR (status <> N'uebermittelt' AND github_number IS NULL)
  )
);

CREATE INDEX ix_problem_meldung_status ON problem.meldung (status, created_at DESC);
CREATE UNIQUE INDEX ux_problem_meldung_github ON problem.meldung (github_number) WHERE github_number IS NOT NULL;
