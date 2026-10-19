-- CampFlow-Events, die keine echte Aktion sind: Einträge, die nur die Anmelde- und
-- Bezahlfunktion von CampFlow nutzen, z. B. Bestellungen von Pullovern und Halstüchern (#337).
-- Jedes Event gilt als Aktion, solange es hier nicht steht; der Schalter bei der Aktion im
-- Leitendenbereich legt die Zeile an oder löscht sie. Ein markiertes Event fehlt im
-- öffentlichen Kalender und in allen Auswahllisten von Aktionen, bekommt keinen KJR-Zuschuss
-- (unabhängig von `organisation.aktion_ohne_zuschuss`, deren Zeile beim Zurücknehmen wieder
-- gilt) und steht in der Abrechnung getrennt unter „Bestellungen und Sonstiges“.
--
-- Eine eigene Tabelle statt einer Art-Spalte in `aktion_ohne_zuschuss`: Beide Angaben sind
-- unabhängig (eine echte Aktion kann ohne Zuschuss sein), und so bleibt die Zuschuss-Wahl
-- erhalten, wenn jemand die Markierung wieder zurücknimmt.

CREATE TABLE organisation.aktion_keine_aktion (
  -- ID des Events in CampFlow (`evt_…`).
  campflow_id varchar(64)   NOT NULL CONSTRAINT pk_aktion_keine_aktion PRIMARY KEY
    CONSTRAINT ck_aktion_keine_aktion_id CHECK (campflow_id LIKE 'evt[_]_%'),
  created_at  datetime2(0)  NOT NULL CONSTRAINT df_aktion_keine_aktion_created_at DEFAULT SYSUTCDATETIME(),
  created_by  nvarchar(254) NOT NULL
);
