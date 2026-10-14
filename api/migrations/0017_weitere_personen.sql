-- Weitere Personen (#301): Altleitende und andere regelmäßig beteiligte Personen, die nicht in
-- der Entra-Gruppe der Leitenden sind. Der Protokoll-Editor bietet sie neben den Leitenden zur
-- Auswahl an (Sitzungsleitung, Anwesende, Zuständige). Gepflegt im Leitendenbereich unter
-- „Weitere Personen“, siehe docs/protokoll-editor.md.

CREATE TABLE organisation.person (
  id         int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_person PRIMARY KEY,
  version    rowversion         NOT NULL,
  name       nvarchar(200)      NOT NULL CONSTRAINT ck_person_name CHECK (LEN(name) > 0),
  -- Login im Tenant (klein geschrieben), falls die Person eines hat; sonst leer.
  login      nvarchar(254)      NOT NULL CONSTRAINT df_person_login DEFAULT N'',
  gruppe     varchar(12)        NOT NULL
    CONSTRAINT ck_person_gruppe CHECK (gruppe IN ('altleitende', 'weitere')),
  -- Inaktive Personen bleiben in alten Protokollen stehen, werden aber nicht mehr angeboten.
  aktiv      bit                NOT NULL CONSTRAINT df_person_aktiv DEFAULT 1,
  created_at datetime2(0)       NOT NULL CONSTRAINT df_person_created_at DEFAULT SYSUTCDATETIME(),
  updated_at datetime2(0)       NOT NULL CONSTRAINT df_person_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by nvarchar(254)      NOT NULL
);
