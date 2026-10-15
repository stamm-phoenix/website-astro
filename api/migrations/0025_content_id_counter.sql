-- Zähler für die IDs der Gruppenstunden und Leitenden (`api/lib/content-ids.ts`). Die beiden
-- Tabellen aus `0024_gruppenstunden_leitende.sql` haben keine IDENTITY-Spalte, weil die
-- Übernahme die IDs aus SharePoint schreibt und die Website kein `SET IDENTITY_INSERT`
-- ausführen darf. Der Zähler steigt nur, damit die ID einer gelöschten Person (und der Ordner
-- ihrer Fotos im Blob Storage) nie an jemand anderen geht. Übernommene IDs zählen mit.

CREATE TABLE content.id_counter (
  table_name varchar(40) NOT NULL CONSTRAINT pk_id_counter PRIMARY KEY
    CONSTRAINT ck_id_counter_table CHECK (table_name IN ('content.gruppenstunde', 'content.leitende')),
  last_id    int         NOT NULL CONSTRAINT ck_id_counter_last_id CHECK (last_id >= 0)
);

-- Schon vorhandene Einträge (z. B. in Previews) zählen mit.
INSERT INTO content.id_counter (table_name, last_id)
SELECT 'content.gruppenstunde', ISNULL(MAX(id), 0) FROM content.gruppenstunde;

INSERT INTO content.id_counter (table_name, last_id)
SELECT 'content.leitende', ISNULL(MAX(id), 0) FROM content.leitende;
