-- Kontakt für die Besuchstage: Name und Handynummer einer Person, die Familien am Tag ihres
-- Besuchs auf ihrer Terminseite sehen (z. B. „Wir stehen im Stau“ oder „Wir sind nicht da“).
-- Ein zentraler Kontakt für alle Termine; Familien rufen nicht bei den Teams an.
-- Leer heißt: kein Kontakt angezeigt.

ALTER TABLE nikolaus.settings ADD
  day_contact_name  nvarchar(100) NULL,
  day_contact_phone nvarchar(30)  NULL;
