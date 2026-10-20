-- Anwesenheit (#274): Kinder können entschuldigt fehlen, und eine Gruppenstunde kann
-- ausgefallen sein.
--
-- Ein entschuldigtes Kind ist eine Zeile in `attendance` mit `excused = 1`. So schließen sich
-- „anwesend“ und „entschuldigt“ über `uq_attendance_person` gegenseitig aus, und die
-- Aufbewahrungsfrist entfernt die CampFlow-ID wie bei anwesenden Kindern. Gäste sind nie
-- entschuldigt.
--
-- Eine ausgefallene Gruppenstunde hat keine Zeilen in `attendance`; der Code löscht sie beim
-- Markieren. Die Statistik zählt sie nicht als Termin.

ALTER TABLE gruppenstunde.attendance
  ADD excused bit NOT NULL CONSTRAINT df_attendance_excused DEFAULT 0;
GO

ALTER TABLE gruppenstunde.attendance
  ADD CONSTRAINT ck_attendance_excused CHECK (guest = 0 OR excused = 0);

ALTER TABLE gruppenstunde.meeting
  ADD cancelled bit NOT NULL CONSTRAINT df_meeting_cancelled DEFAULT 0;
