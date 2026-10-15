-- Sammelbestellungen (#156): ersetzt die SharePoint-Listen „sammelbestellungen“ (Aktionen) und
-- „sammelbestellungenOrders“ (Bestellungen) mit ihren JSON-Spalten. Es gab noch keine produktive
-- Sammelbestellung, deshalb werden keine Daten übernommen; die Listen werden gelöscht.
-- Beschreibung: docs/sammelbestellung-campflow-zahlungen.md.
CREATE SCHEMA sammel;
GO

CREATE TABLE sammel.campaign (
  id           int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_sammel_campaign PRIMARY KEY,
  version      rowversion             NOT NULL,
  -- Schlüssel des Formulars, damit ein wiederholtes Absenden keine zweite Aktion anlegt.
  creation_key varchar(36)            NOT NULL CONSTRAINT uq_sammel_campaign_creation UNIQUE,
  title        nvarchar(200)          NOT NULL CONSTRAINT ck_sammel_campaign_title CHECK (LEN(title) > 0),
  description  nvarchar(2000)         NOT NULL CONSTRAINT df_sammel_campaign_description DEFAULT N'',
  starts_at    datetime2(3)           NOT NULL,
  ends_at      datetime2(3)           NOT NULL,
  archived     bit                    NOT NULL CONSTRAINT df_sammel_campaign_archived DEFAULT 0,
  created_at   datetime2(0)           NOT NULL CONSTRAINT df_sammel_campaign_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_sammel_campaign_period CHECK (ends_at > starts_at)
);

-- Die häufigen Artikel einer Aktion, in der Reihenfolge des Formulars.
CREATE TABLE sammel.catalog_item (
  campaign_id int            NOT NULL CONSTRAINT fk_sammel_catalog_campaign REFERENCES sammel.campaign(id),
  position    smallint       NOT NULL,
  shop        varchar(10)    NOT NULL
    CONSTRAINT ck_sammel_catalog_shop CHECK (shop IN ('ruesthaus', 'eschwege', 'stamm')),
  name        nvarchar(200)  NOT NULL CONSTRAINT ck_sammel_catalog_name CHECK (LEN(name) > 0),
  reference   nvarchar(500)  NOT NULL CONSTRAINT ck_sammel_catalog_reference CHECK (LEN(reference) > 0),
  CONSTRAINT pk_sammel_catalog_item PRIMARY KEY (campaign_id, position)
);

-- Größen und Varianten eines Katalogartikels zur Auswahl, in der Reihenfolge des Formulars.
CREATE TABLE sammel.catalog_variant (
  campaign_id   int           NOT NULL,
  item_position smallint      NOT NULL,
  position      smallint      NOT NULL,
  variant       nvarchar(120) NOT NULL CONSTRAINT ck_sammel_variant CHECK (LEN(variant) > 0),
  CONSTRAINT pk_sammel_catalog_variant PRIMARY KEY (campaign_id, item_position, position),
  CONSTRAINT fk_sammel_variant_item FOREIGN KEY (campaign_id, item_position)
    REFERENCES sammel.catalog_item(campaign_id, position)
);

-- Einladung per E-Mail an die Mitglieder aus CampFlow: eine Zeile je Adresse. „attempted“ ist
-- vor dem Versand reserviert und wird nie automatisch erneut verschickt.
CREATE TABLE sammel.invitation (
  campaign_id int           NOT NULL CONSTRAINT fk_sammel_invitation_campaign REFERENCES sammel.campaign(id),
  address     nvarchar(254) NOT NULL,
  status      varchar(9)    NOT NULL
    CONSTRAINT ck_sammel_invitation_status CHECK (status IN ('pending', 'attempted', 'sent')),
  CONSTRAINT pk_sammel_invitation PRIMARY KEY (campaign_id, address)
);

-- Obergrenze für angeforderte Bestelllinks je Aktion, in UTC-Stunden und -Tagen seit 1970.
CREATE TABLE sammel.link_quota (
  campaign_id int NOT NULL CONSTRAINT pk_sammel_link_quota PRIMARY KEY
    CONSTRAINT fk_sammel_link_quota_campaign REFERENCES sammel.campaign(id),
  hour_window int NOT NULL,
  hour_count  int NOT NULL CONSTRAINT ck_sammel_link_quota_hour CHECK (hour_count >= 0),
  day_window  int NOT NULL,
  day_count   int NOT NULL CONSTRAINT ck_sammel_link_quota_day CHECK (day_count >= 0)
);

-- Eine Bestellung je Aktion und E-Mail-Adresse. Sie entsteht mit dem ersten angeforderten Link
-- (submitted = 0) und gilt erst nach dem Absenden als Bestellung. Ihre rowversion schützt
-- auch Positionen, Zahlung und Zahlungsprotokoll: Jede Änderung daran schreibt die Bestellung
-- in derselben Transaktion mit.
CREATE TABLE sammel.member_order (
  id           int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_sammel_order PRIMARY KEY,
  version      rowversion             NOT NULL,
  campaign_id  int                    NOT NULL CONSTRAINT fk_sammel_order_campaign REFERENCES sammel.campaign(id),
  -- Klein geschrieben, wie sie die Website prüft.
  email        nvarchar(254)          NOT NULL,
  name         nvarchar(200)          NOT NULL CONSTRAINT df_sammel_order_name DEFAULT N'',
  notes        nvarchar(2000)         NOT NULL CONSTRAINT df_sammel_order_notes DEFAULT N'',
  status       varchar(12)            NOT NULL CONSTRAINT df_sammel_order_status DEFAULT 'Eingereicht'
    CONSTRAINT ck_sammel_order_status CHECK (status IN ('Eingereicht', 'Bestellt', 'Eingetroffen', 'Storniert')),
  submitted    bit                    NOT NULL CONSTRAINT df_sammel_order_submitted DEFAULT 0,
  paid         bit                    NOT NULL CONSTRAINT df_sammel_order_paid DEFAULT 0,
  delivered    bit                    NOT NULL CONSTRAINT df_sammel_order_delivered DEFAULT 0,
  total_cents  int                    NULL
    CONSTRAINT ck_sammel_order_total CHECK (total_cents BETWEEN 0 AND 10000000),
  -- Letzter Versand des persönlichen Links (Sperrfrist gegen wiederholte Mails).
  link_sent_at datetime2(3)           NULL,
  created_at   datetime2(0)           NOT NULL CONSTRAINT df_sammel_order_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uq_sammel_order_email UNIQUE (campaign_id, email)
);

CREATE TABLE sammel.order_item (
  order_id        int            NOT NULL CONSTRAINT fk_sammel_item_order REFERENCES sammel.member_order(id),
  position        smallint       NOT NULL,
  shop            varchar(10)    NOT NULL
    CONSTRAINT ck_sammel_item_shop CHECK (shop IN ('ruesthaus', 'eschwege', 'stamm')),
  name            nvarchar(200)  NOT NULL CONSTRAINT ck_sammel_item_name CHECK (LEN(name) > 0),
  reference       nvarchar(500)  NOT NULL CONSTRAINT ck_sammel_item_reference CHECK (LEN(reference) > 0),
  variant         nvarchar(120)  NOT NULL CONSTRAINT df_sammel_item_variant DEFAULT N'',
  quantity        tinyint        NOT NULL CONSTRAINT ck_sammel_item_quantity CHECK (quantity BETWEEN 1 AND 99),
  -- Von Leitenden ausgeschlossen („wird nicht mitbestellt“), mit optionalem Grund.
  excluded        bit            NOT NULL CONSTRAINT df_sammel_item_excluded DEFAULT 0,
  excluded_reason nvarchar(1000) NOT NULL CONSTRAINT df_sammel_item_reason DEFAULT N'',
  CONSTRAINT pk_sammel_order_item PRIMARY KEY (order_id, position),
  CONSTRAINT ck_sammel_item_reason CHECK (excluded = 1 OR excluded_reason = N'')
);

-- Der CampFlow-Beitrag einer Bestellung (#103): zugeordnete Person, Beitragsvorgang mit dem
-- gespeicherten Snapshot, Versandbestätigung und manuelle Zahlungsmarkierung.
CREATE TABLE sammel.payment (
  order_id                 int            NOT NULL CONSTRAINT pk_sammel_payment PRIMARY KEY
    CONSTRAINT fk_sammel_payment_order REFERENCES sammel.member_order(id),
  person_id                varchar(255)   NOT NULL,
  person_name              nvarchar(200)  NOT NULL,
  person_matches_email     bit            NOT NULL,
  assignment_reason        nvarchar(1000) NOT NULL,
  assigned_by_id           nvarchar(255)  NOT NULL,
  assigned_by_name         nvarchar(255)  NOT NULL,
  assigned_at              datetime2(3)   NOT NULL,
  -- Beitragsvorgang; alle Spalten bis error_category sind NULL, solange keiner begonnen hat.
  operation_key            varchar(36)    NULL,
  operation_hash           varchar(64)    NULL,
  operation_state          varchar(9)     NULL
    CONSTRAINT ck_sammel_payment_state CHECK (operation_state IN ('prepared', 'attempted', 'uncertain', 'created')),
  operation_started_at     datetime2(3)   NULL,
  operation_attempted_at   datetime2(3)   NULL,
  snapshot_person_id       varchar(255)   NULL,
  snapshot_amount          int            NULL,
  snapshot_description     nvarchar(200)  NULL,
  -- Bestellung und Aktion, wie sie beim Vorbereiten im Snapshot standen.
  snapshot_order_id        int            NULL,
  snapshot_campaign_id     int            NULL,
  snapshot_revision        varchar(64)    NULL,
  -- Kostenstelle und Kategorie; NULL bei Vorgängen, die vor dieser Zuordnung vorbereitet wurden.
  snapshot_costunit_name   nvarchar(200)  NULL,
  snapshot_category_name   nvarchar(200)  NULL,
  contribution_id          varchar(255)   NULL,
  contribution_reference   nvarchar(100)  NULL,
  error_category           nvarchar(100)  NULL,
  dispatch_confirmed_at    datetime2(3)   NULL,
  dispatch_actor_id        nvarchar(255)  NULL,
  dispatch_actor_name      nvarchar(255)  NULL,
  settlement_paid          bit            NULL,
  settlement_marked_at     datetime2(3)   NULL,
  settlement_actor_id      nvarchar(255)  NULL,
  settlement_actor_name    nvarchar(255)  NULL,
  CONSTRAINT ck_sammel_payment_operation CHECK (
    (operation_key IS NULL AND operation_hash IS NULL AND operation_state IS NULL
      AND operation_started_at IS NULL AND operation_attempted_at IS NULL
      AND snapshot_person_id IS NULL AND snapshot_amount IS NULL
      AND snapshot_description IS NULL AND snapshot_order_id IS NULL
      AND snapshot_campaign_id IS NULL AND snapshot_revision IS NULL
      AND snapshot_costunit_name IS NULL AND snapshot_category_name IS NULL)
    OR (operation_key IS NOT NULL AND operation_hash IS NOT NULL AND operation_state IS NOT NULL
      AND operation_started_at IS NOT NULL AND snapshot_person_id IS NOT NULL
      AND snapshot_amount BETWEEN 1 AND 10000000 AND snapshot_description IS NOT NULL
      AND snapshot_order_id IS NOT NULL AND snapshot_campaign_id IS NOT NULL
      AND snapshot_revision IS NOT NULL)),
  CONSTRAINT ck_sammel_payment_expense CHECK (
    (snapshot_costunit_name IS NULL AND snapshot_category_name IS NULL)
    OR (snapshot_costunit_name IS NOT NULL AND snapshot_category_name IS NOT NULL)),
  -- Beitrags-ID und Referenz genau dann, wenn der Beitrag angelegt oder zugeordnet ist.
  CONSTRAINT ck_sammel_payment_contribution CHECK (
    (operation_state = 'created' AND contribution_id IS NOT NULL
      AND contribution_reference IS NOT NULL)
    OR ((operation_state IS NULL OR operation_state <> 'created')
      AND contribution_id IS NULL AND contribution_reference IS NULL)),
  CONSTRAINT ck_sammel_payment_dispatch CHECK (
    (dispatch_confirmed_at IS NULL AND dispatch_actor_id IS NULL AND dispatch_actor_name IS NULL)
    OR (dispatch_confirmed_at IS NOT NULL AND dispatch_actor_id IS NOT NULL
      AND dispatch_actor_name IS NOT NULL AND operation_state = 'created')),
  CONSTRAINT ck_sammel_payment_settlement CHECK (
    (settlement_paid IS NULL AND settlement_marked_at IS NULL AND settlement_actor_id IS NULL
      AND settlement_actor_name IS NULL)
    OR (settlement_paid IS NOT NULL AND settlement_marked_at IS NOT NULL
      AND settlement_actor_id IS NOT NULL AND settlement_actor_name IS NOT NULL
      AND operation_state = 'created'))
);
-- Ein CampFlow-Beitrag gehört zu höchstens einer Bestellung, auch bei gleichzeitiger Zuordnung.
CREATE UNIQUE INDEX uq_sammel_payment_contribution ON sammel.payment(contribution_id)
  WHERE contribution_id IS NOT NULL;
CREATE UNIQUE INDEX uq_sammel_payment_operation ON sammel.payment(operation_key)
  WHERE operation_key IS NOT NULL;

-- Kontaktadressen der zugeordneten Person aus CampFlow zum Zeitpunkt der Zuordnung.
CREATE TABLE sammel.payment_email (
  order_id int           NOT NULL CONSTRAINT fk_sammel_payment_email_payment REFERENCES sammel.payment(order_id),
  position tinyint       NOT NULL,
  email    nvarchar(254) NOT NULL,
  CONSTRAINT pk_sammel_payment_email PRIMARY KEY (order_id, position)
);

-- Jeder Schritt des Zahlungsablaufs, ohne Obergrenze; Einträge werden nie geändert.
CREATE TABLE sammel.payment_event (
  id            int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_sammel_payment_event PRIMARY KEY,
  order_id      int                NOT NULL CONSTRAINT fk_sammel_event_order REFERENCES sammel.member_order(id),
  at            datetime2(3)       NOT NULL,
  actor_id      nvarchar(255)      NOT NULL,
  actor_name    nvarchar(255)      NOT NULL,
  action        varchar(10)        NOT NULL CONSTRAINT ck_sammel_event_action CHECK (action IN
    ('assigned', 'prepared', 'attempted', 'created', 'uncertain', 'adopted', 'dispatched', 'settled')),
  operation_key varchar(36)        NULL,
  evidence      nvarchar(1000)     NOT NULL CONSTRAINT df_sammel_event_evidence DEFAULT N''
);
CREATE INDEX ix_sammel_payment_event_order ON sammel.payment_event(order_id, id);
