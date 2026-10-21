-- Übertragung angenommener Belege nach CampFlow (Issue #166): Die Kasse überträgt einen Beleg
-- per Knopfdruck über die Playwright-API, danach wird er im Modul „Belege“ gelöscht. Jede Zeile
-- hält Versuch, Ergebnis und Löschung eines Belegs, damit sich nachvollziehen lässt, was wann
-- übertragen wurde. Ohne Fremdschlüssel auf `organisation.beleg`, weil die Zeile den gelöschten
-- Beleg überdauert; Geschäft, Datum und Betrag stehen deshalb hier noch einmal.
-- Ablauf und Zustände: docs/belege-campflow.md.

CREATE TABLE organisation.beleg_campflow (
  beleg_id         int            NOT NULL CONSTRAINT pk_beleg_campflow PRIMARY KEY,
  version          rowversion     NOT NULL,
  -- Gestartet: Aufruf läuft oder sein Ergebnis ist unklar, eine Wiederholung ist sicher.
  -- Fehlgeschlagen: CampFlow hat sicher nichts angelegt. Hochgeladen: gebucht mit Nummer.
  state            varchar(14)    NOT NULL
    CONSTRAINT ck_beleg_campflow_state CHECK (state IN ('Gestartet', 'Fehlgeschlagen', 'Hochgeladen')),
  -- Dateiname in CampFlow und Schlüssel gegen doppelte Belege; bleibt bei Wiederholungen gleich.
  file_name        nvarchar(200)  NOT NULL,
  -- Binäre Kollation wie bei `content.aktion.campflow_id`: CampFlow-IDs unterscheiden Groß- und
  -- Kleinschreibung.
  costunit_id      varchar(64)    COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT ck_beleg_campflow_costunit_id CHECK (costunit_id LIKE 'cun[_]_%'),
  costunit_name    nvarchar(255)  NOT NULL,
  category_id      varchar(64)    COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT ck_beleg_campflow_category_id CHECK (category_id LIKE 'cat[_]_%'),
  category_name    nvarchar(255)  NOT NULL,
  shop             nvarchar(255)  NOT NULL,
  beleg_date       date           NULL,
  amount_cent      int            NOT NULL,
  -- Fehlermeldung des letzten Versuchs, leer nach Erfolg.
  error            nvarchar(1000) NOT NULL CONSTRAINT df_beleg_campflow_error DEFAULT N'',
  campflow_number  varchar(50)    NULL,
  campflow_receipt_id varchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  campflow_expense_id varchar(64) COLLATE Latin1_General_100_BIN2 NULL,
  started_by       nvarchar(254)  NOT NULL,
  started_at       datetime2(3)   NOT NULL,
  uploaded_at      datetime2(3)   NULL,
  -- Wann der Beleg nach der Übertragung im Modul „Belege“ gelöscht wurde.
  beleg_deleted_at datetime2(3)   NULL,
  CONSTRAINT ck_beleg_campflow_uploaded CHECK (
    (state = 'Hochgeladen' AND campflow_number IS NOT NULL AND uploaded_at IS NOT NULL)
    OR (state <> 'Hochgeladen' AND campflow_number IS NULL AND beleg_deleted_at IS NULL)
  )
);
