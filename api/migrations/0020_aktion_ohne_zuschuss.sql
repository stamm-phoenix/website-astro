-- Aktionen ohne KJR-Zuschuss: CampFlow-Aktionen, für die kein Zuschuss beim Kreisjugendring
-- beantragt wird, weil sie formell keinen bekommen können (z. B. eine fremde Aktion, bei der
-- wir nur die Anmeldungen unserer Kinder sammeln) oder weil wir uns dagegen entschieden haben.
-- Jede Aktion ist bezuschussbar, solange sie hier nicht steht; der Schalter im Leitendenbereich
-- (Aktion und Abrechnung) legt die Zeile an oder löscht sie. Ohne Zuschuss fehlt die Aktion in
-- den KJR-Fristen, und die Abrechnung zeigt nur Einnahmen und Ausgaben.

CREATE TABLE organisation.aktion_ohne_zuschuss (
  -- ID der Aktion in CampFlow (`evt_…`).
  campflow_id varchar(64)   NOT NULL CONSTRAINT pk_aktion_ohne_zuschuss PRIMARY KEY
    CONSTRAINT ck_aktion_ohne_zuschuss_id CHECK (campflow_id LIKE 'evt[_]_%'),
  created_at  datetime2(0)  NOT NULL CONSTRAINT df_aktion_ohne_zuschuss_created_at DEFAULT SYSUTCDATETIME(),
  created_by  nvarchar(254) NOT NULL
);
