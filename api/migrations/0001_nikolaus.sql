-- ENTWURF (#165): Nikolausdienst in Azure SQL.
--
-- Ersetzt die SharePoint-Listen „Nikolaus“ (Buchungen), „Nikolaus-Helfende“, „Nikolaus-Einteilung“,
-- „NikolausZustand“ und „Nikolaus-Dispo“ (Altbestand, entfällt ersatzlos). Es gibt keine
-- Datenübernahme, die vorhandenen Daten sind Testdaten.
--
-- Konventionen:
-- - Zeitpunkte sind UTC (`datetime2(0)`, Sekunden genügen). Kalendertage und Slots bleiben lokale
--   Zeit Europe/Berlin, wie in `nikolaus-config.ts`.
-- - Text immer `nvarchar` (Umlaute). Längen entsprechen `NIKOLAUS_MAX_LENGTH`.
-- - `version rowversion` ersetzt das SharePoint-ETag für bedingte Updates.
-- - Slots sind Konfiguration (`getNikolausSlots`) und stehen nicht in der Datenbank.
--
-- Getestet gegen SQL Server 2022 (Container). Mit sqlcmd nur mit `-I` ausführen
-- (QUOTED_IDENTIFIER ON, nötig für die persistierten berechneten Spalten); Treiber wie tedious
-- setzen das von sich aus.

CREATE SCHEMA nikolaus;
GO

-- ---------------------------------------------------------------------------------------------
-- Buchungen
-- ---------------------------------------------------------------------------------------------

CREATE TABLE nikolaus.booking (
  id                int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_booking PRIMARY KEY,
  version           rowversion         NOT NULL,

  -- Slot im Format `YYYY-MM-DDTHH:MM` (lokale Zeit). Verschieben ist ein UPDATE dieser Spalte.
  slot_key          char(16)           NOT NULL
    CONSTRAINT ck_booking_slot_key
      CHECK (slot_key LIKE '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]'),
  -- Eigene Spalte statt berechneter, weil String→date-Konvertierungen nicht als deterministisch
  -- gelten; der CHECK hält sie mit slot_key synchron.
  visit_date        date               NOT NULL,
  season            AS CONVERT(smallint, LEFT(slot_key, 4)) PERSISTED,

  status            nvarchar(12)       NOT NULL
    CONSTRAINT ck_booking_status
      CHECK (status IN (N'Ausstehend', N'Bestaetigt', N'Storniert', N'Abgelaufen')),

  family_name       nvarchar(100)      NOT NULL,
  email             nvarchar(254)      NOT NULL,
  -- Die Standard-Collation ignoriert Groß-/Kleinschreibung, LOWER bleibt trotzdem explizit.
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

  -- Ergebnis des Geocodings; NULL = nicht gefunden oder Dienst nicht erreichbar.
  latitude          decimal(9, 6)      NULL,
  longitude         decimal(9, 6)      NULL,
  geo_precision     varchar(7)         NULL
    CONSTRAINT ck_booking_geo_precision CHECK (geo_precision IN ('address', 'street', 'area')),
  CONSTRAINT ck_booking_geo CHECK (
    (latitude IS NULL AND longitude IS NULL AND geo_precision IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND geo_precision IS NOT NULL)
  ),

  -- SHA-256 (hex) des Links im Bestätigungsmail; der Token selbst wird nie gespeichert.
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

-- Kapazitätsprüfung: Die Buchung wird in einer Transaktion angelegt, die zuerst die blockierenden
-- Buchungen des Slots mit (UPDLOCK, HOLDLOCK) zählt. HOLDLOCK sperrt dabei den Schlüsselbereich
-- dieses Index, sodass eine zweite Buchung für denselben Slot warten muss.
-- Blockierend = Bestaetigt, oder Ausstehend mit reserved_until > jetzt.
CREATE INDEX ix_booking_slot ON nikolaus.booking (slot_key)
  INCLUDE (status, reserved_until);

-- „Eine aktive Buchung pro E-Mail“ hängt von reserved_until und der aktuellen Uhrzeit ab und
-- lässt sich deshalb nicht als eindeutiger Index ausdrücken. Die Prüfung läuft in derselben
-- Transaktion wie die Kapazitätsprüfung; dieser Index sorgt für die Bereichssperre.
CREATE INDEX ix_booking_email ON nikolaus.booking (email_normalized)
  INCLUDE (status, reserved_until);

CREATE INDEX ix_booking_visit_date ON nikolaus.booking (visit_date);

-- Interne Tags der Planung; werden der Familie nie angezeigt.
CREATE TABLE nikolaus.booking_tag (
  booking_id int           NOT NULL
    CONSTRAINT fk_booking_tag_booking REFERENCES nikolaus.booking (id) ON DELETE CASCADE,
  tag        nvarchar(50)  NOT NULL,
  CONSTRAINT pk_booking_tag PRIMARY KEY (booking_id, tag)
);

-- Stufen, deren Vorschlag aus dem Stufen-Abgleich abgelehnt wurde.
CREATE TABLE nikolaus.booking_rejected_stufe (
  booking_id int           NOT NULL
    CONSTRAINT fk_booking_rejected_stufe_booking
      REFERENCES nikolaus.booking (id) ON DELETE CASCADE,
  stufe      nvarchar(30)  NOT NULL,
  CONSTRAINT pk_booking_rejected_stufe PRIMARY KEY (booking_id, stufe)
);
GO

-- ---------------------------------------------------------------------------------------------
-- Helfende
-- ---------------------------------------------------------------------------------------------

CREATE TABLE nikolaus.helper (
  id      int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_helper PRIMARY KEY,
  version rowversion         NOT NULL,
  name    nvarchar(100)      NOT NULL,
  notes   nvarchar(1000)     NOT NULL CONSTRAINT df_helper_notes DEFAULT N''
);

-- Ersetzt das JSON in `Verfuegbarkeit`: eine Zeile pro Tag und Posten.
CREATE TABLE nikolaus.helper_availability (
  helper_id int          NOT NULL
    CONSTRAINT fk_helper_availability_helper REFERENCES nikolaus.helper (id) ON DELETE CASCADE,
  date      date         NOT NULL,
  role      nvarchar(10) NOT NULL
    CONSTRAINT ck_helper_availability_role
      CHECK (role IN (N'Nikolaus', N'Krampus', N'Fahrer*in', N'Engerl', N'Küche')),
  CONSTRAINT pk_helper_availability PRIMARY KEY (helper_id, date, role)
);

-- Ersetzt `TagsPositiv`/`TagsNegativ`.
CREATE TABLE nikolaus.helper_tag (
  helper_id int          NOT NULL
    CONSTRAINT fk_helper_tag_helper REFERENCES nikolaus.helper (id) ON DELETE CASCADE,
  kind      char(8)      NOT NULL CONSTRAINT ck_helper_tag_kind CHECK (kind IN ('positive', 'negative')),
  tag       nvarchar(50) NOT NULL,
  CONSTRAINT pk_helper_tag PRIMARY KEY (helper_id, kind, tag)
);

CREATE TABLE nikolaus.helper_rejected_stufe (
  helper_id int          NOT NULL
    CONSTRAINT fk_helper_rejected_stufe_helper
      REFERENCES nikolaus.helper (id) ON DELETE CASCADE,
  stufe     nvarchar(30) NOT NULL,
  CONSTRAINT pk_helper_rejected_stufe PRIMARY KEY (helper_id, stufe)
);
GO

-- ---------------------------------------------------------------------------------------------
-- Planung: Einteilung und Dispo
-- ---------------------------------------------------------------------------------------------

-- Kopfzeile pro Plan, ersetzt die State-Schlüssel `planning:einteilung` und
-- `planning:dispo:<Datum>`. Das Speichern eines Plans aktualisiert diese Zeile mit
-- `WHERE version = @expected` und ersetzt die Planzeilen in derselben Transaktion. Abgehakte
-- Besuche ändern nur `dispo_visit`, nicht die Kopfzeile, und blockieren das Speichern deshalb
-- nicht (wie heute der Fingerprint ohne Besuchsfelder).
CREATE TABLE nikolaus.planning (
  plan_key   varchar(30)    NOT NULL CONSTRAINT pk_planning PRIMARY KEY
    -- 'einteilung' oder 'dispo:YYYY-MM-DD'
    CONSTRAINT ck_planning_key
      CHECK (plan_key = 'einteilung' OR plan_key LIKE 'dispo:[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  version    rowversion     NOT NULL,
  updated_at datetime2(0)   NOT NULL CONSTRAINT df_planning_updated_at DEFAULT SYSUTCDATETIME(),
  updated_by nvarchar(254)  NOT NULL
);

-- Ersetzt „Nikolaus-Einteilung“: eine Person hat pro Tag höchstens einen Posten.
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
  CONSTRAINT pk_assignment PRIMARY KEY (helper_id, date),
  CONSTRAINT ck_assignment_kitchen CHECK (
    (team = N'Küche' AND role = N'Küche') OR (team <> N'Küche' AND role <> N'Küche')
  )
);

CREATE INDEX ix_assignment_date ON nikolaus.assignment (date, team);

-- Ersetzt den Snapshot `planning:dispo:<Datum>`: ein geplanter Besuch pro Buchung.
CREATE TABLE nikolaus.dispo_visit (
  booking_id         int          NOT NULL CONSTRAINT pk_dispo_visit PRIMARY KEY
    CONSTRAINT fk_dispo_visit_booking REFERENCES nikolaus.booking (id) ON DELETE CASCADE,
  date               date         NOT NULL,
  team               nvarchar(20) NOT NULL,
  -- Position in der Route des Teams, ab 1.
  route_order        smallint     NOT NULL CONSTRAINT ck_dispo_visit_order CHECK (route_order >= 1),
  -- Slot der Buchung beim Speichern der Dispo; weicht ab, wenn sie seitdem verschoben wurde.
  slot_key           char(16)     NOT NULL,
  planned_arrival    time(0)      NOT NULL,
  fixed              bit          NOT NULL CONSTRAINT df_dispo_visit_fixed DEFAULT 0,
  -- Serverzeitpunkt des Abhakens; NULL = nicht besucht. Ersetzt `visited` + `visitedAt`.
  visited_at         datetime2(0) NULL,
  -- Idempotenz der Offline-Warteschlange (`nikolaus-fahrt`): letzte angenommene Änderung.
  visit_operation_id varchar(64)  NULL
);

CREATE INDEX ix_dispo_visit_route ON nikolaus.dispo_visit (date, team, route_order);
GO

-- ---------------------------------------------------------------------------------------------
-- Ersatz für die State-Liste „NikolausZustand“
-- ---------------------------------------------------------------------------------------------
-- `booking-move:*` entfällt: Verschieben ist ein UPDATE von booking.slot_key.

-- `mailquota:<hash>` und `mailquota:<hash>:resend`. Reservieren ist ein einzelnes
-- UPDATE ... WHERE hour_count < @hourly AND day_count < @daily (nach Zurücksetzen abgelaufener
-- Fenster); 0 betroffene Zeilen = Quote erschöpft.
CREATE TABLE nikolaus.mail_quota (
  bucket     varchar(80) NOT NULL CONSTRAINT pk_mail_quota PRIMARY KEY,
  -- Fensternummern wie heute: floor(ms / 3.600.000) bzw. floor(ms / 86.400.000), UTC.
  hour_slot  int         NOT NULL,
  hour_count int         NOT NULL CONSTRAINT ck_mail_quota_hour CHECK (hour_count >= 0),
  day_slot   int         NOT NULL,
  day_count  int         NOT NULL CONSTRAINT ck_mail_quota_day CHECK (day_count >= 0)
);

-- `geocoding:nominatim`, Teil 1: Cache der Adress-Lookups. lookup_key ist der HMAC der Adresse
-- (NIKOLAUS_STATE_SECRET), nie die Adresse im Klartext.
CREATE TABLE nikolaus.geocoding_cache (
  lookup_key    char(64)      NOT NULL CONSTRAINT pk_geocoding_cache PRIMARY KEY,
  expires_at    datetime2(3)  NOT NULL,
  found         bit           NOT NULL,
  unavailable   bit           NOT NULL CONSTRAINT df_geocoding_cache_unavailable DEFAULT 0,
  latitude      decimal(9, 6) NULL,
  longitude     decimal(9, 6) NULL,
  geo_precision varchar(7)    NULL
    CONSTRAINT ck_geocoding_cache_precision CHECK (geo_precision IN ('address', 'street', 'area'))
);

CREATE INDEX ix_geocoding_cache_expires ON nikolaus.geocoding_cache (expires_at);

-- `geocoding:nominatim`, Teil 2: gemeinsames Tempo und Lease über alle Instanzen und Previews.
-- Genau eine Zeile pro Anbieter; Änderungen per UPDATE ... WHERE (bedingt) oder unter UPDLOCK.
CREATE TABLE nikolaus.geocoding_coordination (
  provider        varchar(20)  NOT NULL CONSTRAINT pk_geocoding_coordination PRIMARY KEY,
  next_request_at datetime2(3) NOT NULL,
  lease_owner     varchar(64)  NULL,
  lease_key       char(64)     NULL,
  lease_expires   datetime2(3) NULL,
  lease_started   datetime2(3) NULL
);

INSERT INTO nikolaus.geocoding_coordination (provider, next_request_at)
VALUES ('nominatim', '2000-01-01');

-- `retention:schedule:<Saison>`: Löschtermin pro Saison, ein Kalendermonat nach dem letzten Besuch.
CREATE TABLE nikolaus.retention_policy (
  season     smallint     NOT NULL CONSTRAINT pk_retention_policy PRIMARY KEY,
  last_visit date         NOT NULL,
  delete_on  date         NOT NULL,
  -- Stichtag: Daten mit Besuchsdatum vor diesem Tag werden gelöscht.
  cutoff     date         NOT NULL,
  updated_at datetime2(0) NOT NULL CONSTRAINT df_retention_policy_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_retention_policy_dates CHECK (delete_on > last_visit AND cutoff > last_visit)
);
GO

-- ---------------------------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------------------------
-- Die Website-App (Service Principal) bekommt nur Lese- und Schreibrechte, keine DDL-Rechte.
-- Migrationen laufen mit einer eigenen Identität im Deploy-Workflow. Einmalig, außerhalb der
-- Migrationen:
--
--   CREATE USER [website-astro] FROM EXTERNAL PROVIDER;
--   ALTER ROLE db_datareader ADD MEMBER [website-astro];
--   ALTER ROLE db_datawriter ADD MEMBER [website-astro];
