-- Anonymous monthly totals; no user, session, device or exact visit timestamps.
CREATE TABLE organisation.staff_usage (
  month char(7) NOT NULL,
  module varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
  visits int NOT NULL CONSTRAINT df_staff_usage_visits DEFAULT 0,
  CONSTRAINT pk_staff_usage PRIMARY KEY (month, module),
  CONSTRAINT ck_staff_usage_visits CHECK (visits >= 0)
);
