-- Nikolausdienst (#165): ersetzt die SharePoint-Listen „Nikolaus“ (Buchungen),
-- „Nikolaus-Helfende“, „Nikolaus-Einteilung“, „NikolausZustand“ und „Nikolaus-Dispo“.
--
-- Konventionen:
-- - Zeitpunkte sind UTC. Kalendertage und Slots (`YYYY-MM-DDTHH:MM`) sind lokale Zeit
--   Europe/Berlin, wie in `nikolaus-config.ts`.
-- - Text ist `nvarchar` (Umlaute). Längen entsprechen der Validierung im Code.
-- - `version rowversion` ist die Version für bedingte Updates (früher das SharePoint-ETag).
-- - Slots sind Konfiguration (`getNikolausSlots`) und stehen nicht in der Datenbank.
-- - Kleine Listen (Tags, abgelehnte Stufen) sind JSON-Arrays; die Datenbank prüft das Format.
--
-- Mit sqlcmd nur mit `-I` ausführen (QUOTED_IDENTIFIER ON, nötig für die persistierten
-- berechneten Spalten). Der Migrator (`scripts/db-migrate.ts`) setzt das selbst.

CREATE SCHEMA nikolaus;
GO

-- ---------------------------------------------------------------------------------------------
-- Buchungen
-- ---------------------------------------------------------------------------------------------

CREATE TABLE nikolaus.booking (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_booking PRIMARY KEY,
  version           rowversion         NOT NULL,

  -- Verschieben ist ein UPDATE dieser beiden Spalten; die ID bleibt.
  slot_key          char(16)           NOT NULL
    CONSTRAINT ck_booking_slot_key
      CHECK (slot_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]'),
  -- Eigene Spalte statt berechneter, weil Umwandlungen von Text in ein Datum nicht als
  -- deterministisch gelten; der CHECK hält sie mit slot_key synchron.
  visit_date        date               NOT NULL,
  season            AS CONVERT(smallint, LEFT(slot_key, 4)) PERSISTED,

  status            nvarchar(12)       NOT NULL
    CONSTRAINT ck_booking_status
      CHECK (status IN (N'Ausstehend', N'Bestaetigt', N'Storniert', N'Abgelaufen')),

  family_name       nvarchar(100)      NOT NULL,
  email             nvarchar(254)      NOT NULL,
  email_normalized  AS LOWER(LTRIM(RTRIM(email))) PERSISTED,
  phone             nvarchar(30)       NOT NULL,
  street            nvarchar(100)      NOT NULL,
  postal_code       nvarchar(10)       NOT NULL,
  city              nvarchar(60)       NOT NULL,
  address_notes     nvarchar(500)      NOT NULL CONSTRAINT df_booking_address_notes DEFAULT N'',
  children_count    tinyint            NOT NULL
    CONSTRAINT ck_booking_children CHECK (children_count BETWEEN 1 AND 20),
  with_krampus      bit                NOT NULL,
  hiding_place      nvarchar(500)      NOT NULL,
  notes             nvarchar(1000)     NOT NULL CONSTRAINT df_booking_notes DEFAULT N'',

  -- Ergebnis des Geocodings. Koordinaten gibt es genau bei einem Treffer.
  geo_result        varchar(11)        NOT NULL
    CONSTRAINT ck_booking_geo_result
      CHECK (geo_result IN ('address', 'street', 'area', 'not_found', 'unavailable')),
  latitude          decimal(9, 6)      NULL,
  longitude         decimal(9, 6)      NULL,
  CONSTRAINT ck_booking_geo CHECK (
    (geo_result IN ('address', 'street', 'area') AND latitude IS NOT NULL AND longitude IS NOT NULL) OR
    (geo_result IN ('not_found', 'unavailable') AND latitude IS NULL AND longitude IS NULL)
  ),

  -- Nur für die Planung, nie für die Familie sichtbar.
  internal_tags     nvarchar(1000)     NOT NULL CONSTRAINT df_booking_internal_tags DEFAULT N'[]'
    CONSTRAINT ck_booking_internal_tags CHECK (ISJSON(internal_tags) = 1 AND LEFT(internal_tags, 1) = N'['),
  -- Stufen, deren Vorschlag aus dem Stufen-Abgleich abgelehnt wurde.
  rejected_stufen   nvarchar(200)      NOT NULL CONSTRAINT df_booking_rejected_stufen DEFAULT N'[]'
    CONSTRAINT ck_booking_rejected_stufen CHECK (ISJSON(rejected_stufen) = 1 AND LEFT(rejected_stufen, 1) = N'['),

  -- SHA-256 (hex) des Links in den Mails; der Token selbst wird nie gespeichert.
  token_hash        char(64)           NOT NULL,
  reserved_until    datetime2(0)       NULL,
  confirmed_at      datetime2(0)       NULL,
  changed_at        datetime2(0)       NULL,
  link_sent_at      datetime2(0)       NULL,
  created_at        datetime2(0)       NOT NULL
    CONSTRAINT df_booking_created_at DEFAULT SYSUTCDATETIME(),

  CONSTRAINT ck_booking_visit_date CHECK (visit_date = CONVERT(date, LEFT(slot_key, 10), 126))
);

CREATE UNIQUE INDEX ux_booking_token_hash ON nikolaus.booking (token_hash);
CREATE INDEX ix_booking_slot ON nikolaus.booking (slot_key) INCLUDE (status, reserved_until);
CREATE INDEX ix_booking_email ON nikolaus.booking (email_normalized) INCLUDE (status, reserved_until);
CREATE INDEX ix_booking_visit_date ON nikolaus.booking (visit_date);
GO

-- ---------------------------------------------------------------------------------------------
-- Helfende
-- ---------------------------------------------------------------------------------------------

CREATE TABLE nikolaus.helper (
  id              int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_helper PRIMARY KEY,
  version         rowversion         NOT NULL,
  name            nvarchar(100)      NOT NULL,
  notes           nvarchar(500)      NOT NULL CONSTRAINT df_helper_notes DEFAULT N'',
  positive_tags   nvarchar(1000)     NOT NULL CONSTRAINT df_helper_positive_tags DEFAULT N'[]'
    CONSTRAINT ck_helper_positive_tags CHECK (ISJSON(positive_tags) = 1 AND LEFT(positive_tags, 1) = N'['),
  negative_tags   nvarchar(1000)     NOT NULL CONSTRAINT df_helper_negative_tags DEFAULT N'[]'
    CONSTRAINT ck_helper_negative_tags CHECK (ISJSON(negative_tags) = 1 AND LEFT(negative_tags, 1) = N'['),
  rejected_stufen nvarchar(200)      NOT NULL CONSTRAINT df_helper_rejected_stufen DEFAULT N'[]'
    CONSTRAINT ck_helper_rejected_stufen CHECK (ISJSON(rejected_stufen) = 1 AND LEFT(rejected_stufen, 1) = N'[')
);

-- Eine Zeile pro Tag und Posten, für den sich die Person meldet.
CREATE TABLE nikolaus.helper_availability (
  helper_id int          NOT NULL
    CONSTRAINT fk_helper_availability_helper REFERENCES nikolaus.helper (id) ON DELETE CASCADE,
  date      date         NOT NULL,
  role      nvarchar(10) NOT NULL
    CONSTRAINT ck_helper_availability_role
      CHECK (role IN (N'Nikolaus', N'Krampus', N'Fahrer*in', N'Engerl', N'Küche')),
  CONSTRAINT pk_helper_availability PRIMARY KEY (helper_id, date, role)
);

CREATE INDEX ix_helper_availability_date ON nikolaus.helper_availability (date);
GO

-- ---------------------------------------------------------------------------------------------
-- Planung: Einteilung und Dispo
-- ---------------------------------------------------------------------------------------------
-- Gespeichert wird immer ein ganzer Plan (die Einteilung aller Tage, die Dispo eines Tages) in
-- einer Transaktion. Gleichzeitiges Speichern verhindert eine Sperre pro Plan (sp_getapplock),
-- veraltete Stände ein Fingerprint über den Inhalt im Code.

-- Eine Person hat pro Tag höchstens einen Posten.
CREATE TABLE nikolaus.assignment (
  helper_id int          NOT NULL
    CONSTRAINT fk_assignment_helper REFERENCES nikolaus.helper (id) ON DELETE CASCADE,
  date      date         NOT NULL,
  -- Teamname des Tages (z. B. 'A') oder 'Küche'.
  team      nvarchar(20) NOT NULL,
  role      nvarchar(10) NOT NULL
    CONSTRAINT ck_assignment_role
      CHECK (role IN (N'Nikolaus', N'Krampus', N'Fahrer*in', N'Engerl', N'Küche')),
  fixed     bit          NOT NULL CONSTRAINT df_assignment_fixed DEFAULT 0,
  CONSTRAINT pk_assignment PRIMARY KEY (helper_id, date)
);

CREATE INDEX ix_assignment_date ON nikolaus.assignment (date);

-- Ein geplanter Besuch pro Buchung und Tag. Wird eine Buchung auf einen anderen Tag verlegt,
-- bleibt ihre Zeile im alten Plan, bis dieser neu gespeichert wird.
CREATE TABLE nikolaus.dispo_visit (
  date               date          NOT NULL,
  booking_id         int           NOT NULL
    CONSTRAINT fk_dispo_visit_booking REFERENCES nikolaus.booking (id) ON DELETE CASCADE,
  team               nvarchar(20)  NOT NULL,
  -- Position in der Route des Teams, ab 1.
  route_order        smallint      NOT NULL CONSTRAINT ck_dispo_visit_order CHECK (route_order >= 1),
  -- Slot der Buchung beim Speichern der Dispo; weicht ab, wenn sie seitdem verschoben wurde.
  slot_key           char(16)      NOT NULL,
  planned_arrival    char(5)       NOT NULL
    CONSTRAINT ck_dispo_visit_arrival CHECK (planned_arrival LIKE '[0-2][0-9]:[0-5][0-9]'),
  fixed              bit           NOT NULL CONSTRAINT df_dispo_visit_fixed DEFAULT 0,
  -- Serverzeitpunkt des Abhakens; NULL = nicht besucht.
  visited_at         datetime2(3)  NULL,
  -- Idempotenz der Offline-Warteschlange (`nikolaus-fahrt`): letzte angenommene Änderung.
  visit_operation_id varchar(36)   NULL,
  CONSTRAINT pk_dispo_visit PRIMARY KEY (date, booking_id)
);

CREATE INDEX ix_dispo_visit_booking ON nikolaus.dispo_visit (booking_id);
GO

-- ---------------------------------------------------------------------------------------------
-- Gemeinsamer Zustand
-- ---------------------------------------------------------------------------------------------
-- Kleine JSON-Dokumente, die alle Instanzen teilen: Mailquote (`mailquota:*`), Tempo, Lease
-- und Cache des Geocodings (`geocoding:nominatim`), Löschtermine und -berichte
-- (`retention:*`). Geändert wird ein Dokument immer unter einer Zeilensperre.

CREATE TABLE nikolaus.state (
  state_key  varchar(200)  NOT NULL CONSTRAINT pk_state PRIMARY KEY,
  value      nvarchar(max) NOT NULL CONSTRAINT ck_state_value CHECK (ISJSON(value) = 1),
  version    rowversion    NOT NULL,
  updated_at datetime2(0)  NOT NULL CONSTRAINT df_state_updated_at DEFAULT SYSUTCDATETIME()
);
