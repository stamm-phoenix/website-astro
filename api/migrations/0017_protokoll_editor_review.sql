-- Protokoll-Editor, Schritt 2 (#277): Review, Freigabe mit PDF im Protokoll-Ordner und Versand
-- an alle Leitenden. Siehe docs/protokoll-editor.md. Nur neue, leere Spalten; Entwürfe bleiben.

ALTER TABLE protokoll.protokoll ADD
  -- Wer das Protokoll zuletzt zum Review gegeben hat.
  submitted_at        datetime2(0)   NULL,
  submitted_by        nvarchar(254)  NULL,
  -- Hinweis der Reviewerin oder des Reviewers beim Zurückgeben.
  review_note         nvarchar(2000) NULL,
  approved_at         datetime2(0)   NULL,
  approved_by         nvarchar(254)  NULL,
  -- Das PDF, das bei der Freigabe im Protokoll-Ordner in SharePoint abgelegt wurde.
  pdf_drive_id        nvarchar(200)  NULL,
  pdf_item_id         nvarchar(100)  NULL,
  pdf_name            nvarchar(260)  NULL,
  pdf_url             nvarchar(2000) NULL,
  -- Versand: `attempted` steht vor dem Abschicken der Mail; bleibt es stehen, ist offen, ob sie
  -- rausging. `delivery_attempt` unterscheidet die Versuche.
  delivery_state      varchar(10)    NULL
    CONSTRAINT ck_protokoll_editor_delivery CHECK (delivery_state IN ('attempted', 'sent')),
  delivery_attempt    varchar(36)    NULL,
  delivery_recipients int            NULL,
  delivery_at         datetime2(0)   NULL,
  delivery_by         nvarchar(254)  NULL;
GO

-- Jede Datei gehört höchstens zu einem Protokoll; die Liste der Protokoll-Dateien blendet sie aus.
CREATE UNIQUE INDEX ux_protokoll_editor_pdf ON protokoll.protokoll (pdf_drive_id, pdf_item_id)
  WHERE pdf_item_id IS NOT NULL;
