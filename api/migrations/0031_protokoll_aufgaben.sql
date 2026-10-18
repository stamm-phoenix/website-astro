-- Aufgaben aus dem Protokoll-Editor (#277, Schritt 3): Bei der Freigabe eines Protokolls
-- entstehen aus seinen Aufgaben-Einträgen echte Aufgaben. Sie merken sich Protokoll, Eintrag
-- und Tagesordnungspunkt; der Eintrag macht das Anlegen wiederholbar, ohne doppelte Aufgaben.
ALTER TABLE organisation.task ADD
  protokoll_id int NULL CONSTRAINT fk_task_protokoll REFERENCES protokoll.protokoll(id),
  -- ID des Aufgaben-Eintrags im Protokoll (`ProtokollAufgabe.id`).
  protokoll_aufgabe nvarchar(40) NULL,
  -- Nummer und Titel des Tagesordnungspunkts beim Anlegen, z. B. „3. Planung“.
  protokoll_punkt nvarchar(250) NOT NULL CONSTRAINT df_task_protokoll_punkt DEFAULT N'';
GO
CREATE UNIQUE INDEX uq_task_protokoll_aufgabe ON organisation.task(protokoll_id, protokoll_aufgabe)
  WHERE protokoll_id IS NOT NULL;
