-- Essensplanung: Leitende des Stammes öffnen ihre Planungen aus dem Leitendenbereich, ohne sich
-- neue Links schicken zu lassen. Jedes Mitglied mit einer Adresse auf `@stamm-phoenix.de`
-- bekommt dafür beim ersten Aufruf der Übersicht einen zweiten persönlichen Token, der neben dem
-- Link aus der Mail gilt und dieselben Rechte gibt. Er steht im Klartext hier, weil die Übersicht
-- ihn bei jedem Aufruf wieder ausgibt; abgerufen wird er nur über den Login des Leitendenbereichs.
-- Mit dem Entziehen des Zugangs gilt er nicht mehr. Beschreibung: docs/essensplanung.md
-- (Zugang aus dem Leitendenbereich).

-- Nur anlegen, wenn es die Tabelle noch nicht gibt: Die Vorschau von PR 501 hat sie schon unter
-- dem früheren Namen 0077 angelegt, bevor 0077 in main vergeben wurde.
IF OBJECT_ID(N'essen.leitung_link', N'U') IS NULL
CREATE TABLE essen.leitung_link (
  mitglied_id  int            NOT NULL CONSTRAINT pk_essen_leitung_link PRIMARY KEY
    CONSTRAINT fk_essen_leitung_link_mitglied REFERENCES essen.mitglied(id) ON DELETE CASCADE,
  token        varchar(43)    COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT uq_essen_leitung_link_token UNIQUE,
  erstellt_am  datetime2(0)   NOT NULL CONSTRAINT df_essen_leitung_link_erstellt_am DEFAULT SYSUTCDATETIME()
);
