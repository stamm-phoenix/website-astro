# Implementation plan for issue #89

Planning date: 1 October 2026. Base commit: `2afd411`.
Working branch: `plan/89-campflow-payments`.

This document records the original plan for [issue #89](https://github.com/stamm-phoenix/website-astro/issues/89), the CampFlow payment integration for the collective ordering system introduced in [issue #59](https://github.com/stamm-phoenix/website-astro/issues/59). The subsequent implementation on `feat/89-campflow-payments` follows the user's decision to use manual recovery, dashboard dispatch and manual payment marking. See the [implemented workflow and deployment requirements](sammelbestellung-campflow-zahlungen.md). No production lists, contributions or payment requests were changed during development.

## Intended outcome

Staff can associate a submitted order with one CampFlow person, confirm the final amount, create its contribution and record its CampFlow ID and payment reference. They can see whether a payment request was sent, whether payment is confirmed and whether an operation needs investigation.

Repeated clicks, concurrent staff sessions, server restarts and uncertain responses must not cause automatic duplicate contributions or payment requests. Delivery remains independent of payment. Existing orders continue to support the manual workflow.

The integration must distinguish a local reservation from an externally completed operation. SharePoint ETags alone cannot guarantee exactly one creation across SharePoint and CampFlow. Full automatic recovery requires a supported CampFlow deduplication or reconciliation mechanism. Until that is confirmed, ambiguous attempts stop for manual investigation. Do not claim an automatic exactly-once guarantee based solely on a stored local flag.

## Repository findings

| Area                                                       | Current behavior                                                                                            | Consequence for this issue                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `api/lib/campflow.ts`                                      | GET requests, bearer token, 20-second timeout, cursor pagination, typed error class                         | Add an explicit write adapter with no implicit retries. Preserve existing readers.                                        |
| `api/lib/sammelbestellung-list.ts`                         | One order per campaign and normalized email, enforced by unique `OrderKey`; ETag-checked updates            | Keep family orders. Add payment metadata to the existing order row so reservation and order locking use the same ETag.    |
| `api/lib/sammelbestellung-model.ts`                        | One final `totalCents`, `paid`, `delivered`; no person or contribution mapping                              | Introduce staff payment details and a smaller member payment summary.                                                     |
| `api/endpoints/sammelbestellungen.ts`                      | Member saves reset `BetragCent` and `Bezahlt`; shared invitation access does not verify membership          | Do not trust order email as proof of a CampFlow identity. Block edits once a contribution operation begins.               |
| `api/endpoints/intern-pflege-sammelbestellungen.ts`        | Staff can change status and final amount; excluding or restoring articles resets amount and payment         | Add central guards to every mutation that could invalidate a contribution.                                                |
| `api/lib/sammelbestellung-invitations.ts`                  | Uses `primary_email` and `cc_emails`, filters current members and reserves mail attempts durably with ETags | Reuse matching conventions and the reservation approach, with explicit recovery states for payments.                      |
| `api/lib/pflege-api.ts`                                    | Calls `requireStaff` before work, maps conflicts and logs the actor                                         | New list write handlers use this wrapper. Payment attempts also need durable actor records, including ambiguous outcomes. |
| `web/src/components/sammelbestellungen/SammelStaff.svelte` | Final amount entry and manual payment/delivery controls, indicative shop prices                             | Add contribution actions here. Shop estimates never determine the amount to charge.                                       |
| `api/test/sammelbestellungen.test.ts`                      | Node test runner with mocked SharePoint, environment and mail operations                                    | Extend the same test approach with a stateful ETag store and simulated CampFlow writes.                                   |
| `README.md`                                                | Documents manual payments and SharePoint setup                                                              | Extend setup, recovery and payment reconciliation instructions.                                                           |

The frontend re-exports the shared order interfaces through `web/src/lib/types.ts`. Shared serializable types should remain in `api/lib/sammelbestellung-model.ts`, without browser or Node dependencies. New shared object shapes use interfaces.

The supplied project instructions describe Astro 5. The checked-in `web/package.json` currently declares Astro 7.3.5. Follow the actual repository dependencies when implementing and validating; framework upgrades are outside this issue.

## Verified CampFlow capabilities and open questions

The public documentation was fetched without authentication on the planning date. The web reader could not load the CampFlow pages, so they were read directly over HTTPS. No live authenticated CampFlow calls were made.

| Capability                                                                      | Evidence                                                                                                                                                                                                       | Planning decision                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Create contributions                                                            | [Contribution documentation](https://docs.campflow.de/docs/beitraege/) documents `POST /fees` with a `data` array, positive integer `amount` in cents, `description`, and `person_id` or `person_external_id`. | Use one contribution per request initially, inside a one-element array.                                  |
| Creation result                                                                 | The same page documents HTTP 201 and a response array containing `id`, `reference`, `amount`, `description` and `person_id`, in request order.                                                                 | Validate the complete result before marking creation as successful. Persist ID and reference separately. |
| Accounting assignment                                                           | The contribution page documents optional `attached_expense` fields.                                                                                                                                            | Leave them unset initially unless the tribe specifies the cost unit, category and sphere.                |
| Person lookup                                                                   | [Person listing](https://docs.campflow.de/docs/personen/abrufen/) and [individual lookup](https://docs.campflow.de/docs/personen/einzelne-personen/) document list-scoped reads and IDs.                       | Use existing member reads and validate the selected person on the server.                                |
| Contact fields                                                                  | [Standard fields](https://docs.campflow.de/docs/felder/liste-standardfelder/) documents `primary_email`, `cc_emails`, membership dates and nullable fields.                                                    | Match primary and CC addresses, keep all candidates and handle missing fields.                           |
| Error responses                                                                 | [Status codes](https://docs.campflow.de/docs/grundlagen/statuscodes/) documents rate limiting and warns that error body structures can change.                                                                 | Use status codes for classification. Treat optional error details defensively.                           |
| Member portal                                                                   | [Portal sessions](https://docs.campflow.de/docs/mitgliederportal/) documents a login-link API.                                                                                                                 | It is not evidence of a payment-request endpoint or payment status API. Do not use it as a substitute.   |
| Idempotency, contribution lookup, request dispatch, payment reads, cancellation | These capabilities are not described in the inspected contribution documentation.                                                                                                                              | Treat them as unverified rather than nonexistent. Require confirmation before depending on them.         |

Before enabling real writes, obtain a supported contract from CampFlow documentation or support for:

1. An idempotency key, its scope and retention, behavior for a changed payload, and the result of replaying a successful request.
2. Finding contributions by ID and a stable external marker, including pagination, visibility delay and whether lookup absence proves no contribution was created.
3. Whether `POST /fees` itself sends notifications or starts any collection process. This affects the first action's confirmation and whether dispatch is a separate operation.
4. The supported payment-request method, recipients including CC addresses, reference and payment instructions, delivery confirmation, and duplicate-send handling.
5. Payment status values, partial payments, refunds, cancellation, polling or webhooks, and supported authentication.
6. Rejection guarantees for 403, 422, 429 and server errors. A non-success HTTP response is not universally proof that no write occurred.
7. Token permissions, account subscription requirements, amount and description limits, and a test workspace or sandbox.
8. A supported correction workflow for a contribution whose amount or assigned person was wrong.

Record the answers and sanitized examples in the implementation PR. Do not invent `GET /fees`, send routes, idempotency headers or provider status fields.

## Person assignment and family orders

Preserve one family order per campaign/email. This issue does not introduce separate sibling orders or split a single amount between several people.

Staff see the order name and email beside current CampFlow candidates. Normalize emails exactly as the existing order validator does. Consider both `primary_email` and `cc_emails`, deduplicate candidates by person ID, and use membership dates consistently with invitations.

- One candidate: preselect as a suggestion; require staff confirmation before charging.
- Several candidates: require an explicit selection. Never choose the first match or charge every sibling.
- No candidates: allow staff to search current members and select a person with a recorded reason for the different contact address. Otherwise retain manual payment.
- Former members or unavailable records: display the reason and retain manual payment. Any exception policy needs an explicit operational decision.

Use the immutable CampFlow `person_id` for the contribution. Store who confirmed the mapping and when. Names and emails are context, not identifiers. Do not create new CampFlow people or modify their `external_id` values for this integration.

The selected person is the billing assignment for the entire order. Staff must confirm which person should carry a shared family's contribution. A matching email does not establish who is financially responsible or who should receive a payment request.

Return a dedicated candidate DTO with only ID, display name, relevant contact addresses and membership context. Do not return whole CampFlow person objects, bank information, health fields or portal session links. Order-link holders cannot change this mapping or call payment actions.

## Final amount and order locking

Creation requires a submitted, non-cancelled order in `Bestellt` or `Eingetroffen`, an explicitly confirmed person and a positive final amount stored in integer cents. An archived campaign cannot start a new contribution. Known existing contributions can still be inspected and reconciled after archival.

The current local validation accepts zero up to 10,000,000 cents. Keep zero valid for manual/free orders but reject contribution creation for zero. Apply the stricter of the existing upper limit and CampFlow's verified limit. Never convert indicative unit prices into a final charge automatically.

Snapshot the amount, person, order/campaign IDs, description and billable item revision before the external request. Create a stable operation key and payload hash on the server. Retries for that operation retain the same identity and exact payload. Include a readable order marker in the description, for example `Sammelbestellung Frühjahr 2027 · Bestellung 42`, within verified provider limits. This marker is a recovery aid, not a provider uniqueness constraint.

Once reserved, freeze amount, person, articles, exclusions and reopening into `Eingereicht`. Freeze cancellation too until staff resolve the external contribution. Apply these rules on the server in member save, staff status, item exclusion/restoration and person assignment handlers. Client disabled controls are insufficient.

Delivery updates and unrelated notes may proceed if they preserve the contribution snapshot. Existing paid orders cannot create a new contribution in the initial release. Staff should adopt an existing CampFlow contribution if one already exists, rather than generating another debt.

Do not clear a contribution ID, reference or operation history when a staff edit changes an order. Corrections after creation require the supported provider correction process and an explicit later revision; they are not a generic retry. Initially show instructions for manual correction and retain the lock.

## Persistence proposal

Add two plain-text multiple-line JSON columns to the existing orders list. Disable rich text and append-only mode. The final internal names are proposed below and must be documented before deployment.

| Column                      | Content                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CampflowZahlung`           | Versioned billing snapshot, person assignment, stable operation key/hash, creation state, contribution ID/reference, dispatch state and payment observation |
| `CampflowZahlungsprotokoll` | Bounded, append-in-application event history with actor, timestamp, operation key, state change, sanitized error category and manual evidence               |

Update the state and relevant audit event in the same ETag-checked order-row update. Missing/blank payment JSON means a legacy/manual order. Malformed nonblank JSON fails visibly and blocks payment actions rather than resetting to a new empty operation. Unsupported future schema versions also block writes.

Keep `BetragCent`, `Bezahlt` and `Ausgeliefert` for compatibility. The payment snapshot retains the confirmed contribution amount independently of later provider observations. Add a staff-only projection for operational state and a member projection that exposes only their own amount, appropriate reference, dispatch summary and payment summary. Extend `publicSammelOrder` deliberately; do not accidentally expose actor IDs, failure details or reconciliation evidence.

Use separate creation, dispatch and settlement states. A created contribution is not a sent request; a sent request is not a payment. Proposed creation states are `none`, `prepared`, `attempted`, `created`, `rejected` and `uncertain`. Dispatch needs its own `not_requested`, `attempted`, `sent`, `failed` and `uncertain` states, plus a delivery method. Settlement retains its source and observation time; exact provider values depend on the verified contract.

Bound stored JSON and audit history, define archival of older events, and retain enough evidence for accounting recovery. Existing actor logs do not replace durable state. Keep provider tokens and personal order-link secrets out of every record and log.

## Contribution creation and crash recovery

1. Authenticate staff through `pflegeHandler`, validate the request and require the loaded concrete ETag.
2. Read the order and campaign, confirm eligibility and selected person, and reject changes to an existing operation payload.
3. Persist `prepared` with the immutable snapshot and audit event using the order ETag. A conflict ends this request before any CampFlow write.
4. Transition that operation to `attempted` with a concrete ETag before calling CampFlow. Only the request that receives an unambiguous successful reservation response may dispatch the POST.
5. Send one contribution using the confirmed provider contract. Do not retry the POST inside the HTTP adapter.
6. On a validated 201 response, store the ID, reference and returned snapshot as `created`. Verify exactly one result with the expected person, amount and description. A malformed or mismatched success is ambiguous.
7. If recording success conflicts with an unrelated order update, reload and retry only the local recording against the latest ETag after checking the same operation key. Never repeat the external POST to fix a local persistence error.
8. If a network error, timeout, server failure or ambiguous response occurs, persist `uncertain` when possible. If persistence fails, the durable `attempted` record still blocks another creation.

| Failure point                                            | Recovery                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Before preparation is persisted                          | Reload; no external write was dispatched.                                                            |
| Preparation write returns ambiguously                    | Reload the stored state. Do not proceed based on an assumed reservation.                             |
| Crash in `prepared`, before dispatch reservation         | Another request may reserve via ETag. The old request must also win that reservation before sending. |
| Dispatch reservation response is lost                    | Treat a stored `attempted` state as ambiguous. Do not assume the external request was skipped.       |
| Crash after reservation but before POST                  | Investigate; local state cannot distinguish this from a dispatched request.                          |
| CampFlow creates a contribution but the response is lost | Reconcile the existing contribution. Never blindly create another one.                               |
| Valid response received, local persistence fails         | Preserve `attempted`/`uncertain`; reconcile and adopt the returned/existing contribution.            |
| Browser loses the endpoint response after local success  | Reload and return the recorded contribution without another POST.                                    |
| Same action arrives concurrently                         | One ETag reservation wins; the other returns conflict or the recorded result.                        |

For rejected requests, allow another attempt only when the verified contract guarantees that nothing was created. Treat 429 as retryable only under that guarantee and respect supported backoff. Do not reuse the current generic CampFlow error message encouraging users to try again for uncertain writes.

If CampFlow supports idempotency, persist and send its documented key for every attempt and test replay with the same and changed payloads. If it supports reliable lookup, match the operation marker, person and amount and adopt only one exact result. Multiple matches require investigation.

Without these capabilities, provide a staff reconciliation action that records an existing contribution ID/reference and evidence from the dashboard or CampFlow support. Validate the association through supported reads when available. Clearly label manual verification when no API check exists. Prevent a contribution ID from being adopted by two orders using a verified unique storage constraint or an equivalent durable registry, rather than a racy list scan.

A local expired timer or a dashboard search returning no rows is not enough to release an uncertain attempt. A delayed original worker might still dispatch. Before allowing another write, establish that the original execution cannot resume and that CampFlow confirms no contribution exists. If that cannot be established, keep creation blocked. Do not offer a general-purpose reset button.

## Payment requests and settlement

Choose one supported dispatch path after CampFlow confirms the contract:

- If contribution creation already sends the intended request, represent that as part of the documented creation outcome. Do not issue a second message.
- If a separate supported send API exists, reserve dispatch durably, use its deduplication mechanism if available and reconcile ambiguous outcomes separately from creation.
- If sending is supported only in the CampFlow dashboard, show the stored contribution/reference and clear dashboard instructions. Staff record manual dispatch with actor and timestamp. Label this as a manual workflow; it does not fulfill automatic dispatch by itself.
- Consider website mail only after confirming CampFlow's supported payment instructions, recipients and workflow. The existing `sendSammelStaffMessage` is a general message, not a substitute for a supported contribution request. Never fabricate bank details or a payment link.

Before dispatch, show amount, assigned person, actual recipient information if available and reference. Do not assume the order email is the CampFlow request recipient. Reserve before sending and never retry an uncertain delivery automatically. Failed notification must not roll back or recreate a contribution.

For supported payment reads, begin with an explicit staff `Zahlungsstatus abgleichen` action. Store source, checked timestamp and normalized provider status. Define how partial payments, refunds and cancellation affect `Bezahlt` after the provider values are known. A failed sync retains the last known status and shows staleness; it must not set an order to unpaid.

For integrated orders with reliable provider status, use CampFlow as the settlement authority and prevent silent manual checkbox overrides. If reads are unavailable, keep manual payment marking and record its source/actor/time. Existing manual orders retain their current behavior. Delivery is never inferred from settlement. Scheduled polling or webhooks can follow once the provider contract and deployment support are established.

## Proposed API and frontend changes

Use routes under `/api/intern/pflege/sammelbestellungen/orders/{id}/`. Names below are proposals; keep their actions narrow and preserve the existing order PATCH.

| Action                   | Proposed method/path suffix   | Requirement                                                                  |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------- |
| Read mapping suggestions | `GET campflow-persons`        | Staff authentication, minimal candidate data, bounded search/pagination      |
| Confirm assignment       | `PATCH campflow-person`       | Order ETag, person ID, reason when contacts differ                           |
| Preview billing          | `POST contribution/preview`   | No financial write; server-calculated snapshot and confirmation hash         |
| Create contribution      | `POST contribution`           | ETag and confirmed preview; durable reservation before POST                  |
| Inspect recovery state   | `GET contribution`            | Return stored state without triggering a write                               |
| Reconcile/adopt          | `POST contribution/reconcile` | Same operation identity, evidence, supported lookup or audited manual path   |
| Dispatch request         | `POST payment-request`        | Created contribution, confirmed supported method and independent reservation |
| Refresh settlement       | `POST payment-status/sync`    | Supported reads only; no contribution creation                               |

All writes use `pflegeHandler`, which performs `requireStaff` before data access, and return `no-store` responses. Validate new inputs in `api/lib/pflege-validation.ts`; centralize payment domain guards in a dedicated module. Route registration belongs in `api/main.ts`. Existing module navigation can remain unchanged because payment actions live inside the current staff order view.

Use dedicated domain errors such as `PERSON_SELECTION_REQUIRED`, `FINAL_AMOUNT_REQUIRED`, `CONTRIBUTION_LOCKED`, `CONTRIBUTION_UNCERTAIN` and `PAYMENT_REQUEST_UNCERTAIN`. Map stale versions to 409. Return field errors for validation failures and distinguish configuration/permission problems from uncertain outcomes. UI recovery should depend on the returned persisted state, not a broad HTTP retry rule.

In the staff order dialog, show assignment and final amount before the create action. Reuse `FormField`, `EditDialog`, `StatusNotice` and `sendApi`. The preview states what will be charged and any verified notification side effect. Disable duplicate clicks while running and refresh the order after every outcome.

The order card shows creation state, reference, dispatch state and payment source/time. Ambiguous states show `Ergebnis unklar. Vor einem weiteren Versuch in CampFlow prüfen.` with the recovery action. Existing payment and delivery filters retain their meaning. Avoid adding every technical state as a top-level filter in the first release.

Update `SammelMember.svelte` only with appropriate order-facing information. Do not offer creation, mapping or reconciliation actions there. Maintain semantic headings, keyboard-operated dialogs, visible focus, associated input errors and live status announcements. Verify the dialogs and long references on mobile and desktop.

## File-level work list

| File                                                                                     | Planned change                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `api/lib/campflow.ts`                                                                    | Explicit typed POST support and defensive success validation; preserve GET behavior and timeout cleanup |
| New `api/lib/campflow-fees.ts`                                                           | Provider contribution adapter and only those lookup/dispatch/status methods confirmed by CampFlow       |
| New `api/lib/sammelbestellung-payments.ts`                                               | Assignment, snapshots, state transitions, reservations, adoption and recovery rules                     |
| `api/lib/sammelbestellung-list.ts`                                                       | Payment-column parsing/persistence and explicit staff/member projections                                |
| `api/lib/sammelbestellung-model.ts`, `web/src/lib/types.ts`                              | Shared interfaces and minimal public payment summary                                                    |
| `api/lib/pflege-validation.ts`                                                           | Payment action validation, IDs, evidence and confirmation input                                         |
| `api/endpoints/intern-pflege-sammelbestellungen.ts` or a dedicated payment endpoint file | Authenticated handlers and guards on existing staff mutations                                           |
| `api/endpoints/sammelbestellungen.ts`                                                    | Server enforcement of billing locks on member mutations                                                 |
| `api/main.ts`                                                                            | Register payment routes                                                                                 |
| `api/lib/environment.ts`, `api/local.settings.example.json`                              | Server-side creation and dispatch feature gates, disabled by default                                    |
| `web/src/components/sammelbestellungen/SammelStaff.svelte`                               | Payment controls and independent state display; extract a payment dialog if needed                      |
| `web/src/components/sammelbestellungen/SammelMember.svelte`                              | Member-facing summary and locked editing explanation                                                    |
| New API payment tests; existing ordering tests                                           | Provider mocks, concurrent ETag store, crash cases and mutation regressions                             |
| `README.md`                                                                              | Columns, permissions, feature gates, manual recovery, dispatch and settlement operations                |

## Implementation sequence for a later PR

1. Resolve the provider contract questions and record whether the first supported release can automate creation, dispatch and settlement. Define the manual fallback without presenting it as full automation.
2. Implement typed payment state parsing, legacy defaults, audit records and all mutation locks. Keep external writes disabled. Test these rules before adding the provider POST.
3. Implement candidate matching, explicit assignment and billing preview. Complete family-order and no-match cases without financial calls.
4. Implement one-order contribution reservation and creation with simulated responses. Complete success persistence, adoption and uncertain-state recovery before exposing the create button.
5. Implement the confirmed dispatch path and its separate failure recovery. Add settlement reads or the documented manual process.
6. Complete staff/member UI, error messages, setup and operational instructions. Verify the full workflow with mocks.
7. Review the concrete PR diff and validation results. Provision required columns and constraints through an explicit deployment step. Enable production actions only after the provider contract and recovery path are accepted.

If dispatch cannot be supported, keep that part of issue #89 open. A preparatory or creation-only PR must describe its remaining scope clearly. No provider-support messages, PRs, pushes or production provisioning are part of this planning pass.

## Verification plan

Use synthetic `example.test` identities and mocked network responses. Tests must fail on unexpected outbound requests. They must not use production CampFlow credentials, real contributions, real payment requests or production SharePoint rows.

| Test group         | Required cases                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment         | Unique match, shared family address, CC match, no match, null fields, duplicate candidates, former/future members, missing selected person                              |
| Amount             | Null, zero, negative, decimal cents, unsafe integer, excessive amount, confirmed final amount independent of shop estimates                                             |
| Authorization      | Anonymous, wrong provider, foreign tenant and order-link-only caller rejected before provider/list access                                                               |
| Persistence        | Legacy blank columns, malformed JSON, unknown schema, oversize records, missing concrete ETag and provider ID already assigned elsewhere                                |
| Creation           | Correct one-element payload, valid ID/reference saved, replay returns existing result, immutable snapshot mismatch rejected                                             |
| Concurrency        | Two staff requests on one ETag, overlapping member save, staff amount edit, item exclusion and cancellation; at most one reserved POST                                  |
| Ambiguous outcomes | Timeout after remote success, transport failure, 5xx, malformed 201, unexpected response length/person/amount, lost reservation response                                |
| Crash boundaries   | Before/after each durable write, before POST, after remote creation and before local success recording; reload never blindly resends                                    |
| Recovery           | Local-only success persistence retry, exact remote adoption, multiple matches, no-match without absence guarantee, delayed original worker, failed recovery persistence |
| Provider rejection | 401/402/403/422/429 with defensive error parsing and only documented safe retry behavior                                                                                |
| Dispatch           | Contribution creation does not imply sent status; duplicate click, ambiguous send, mail succeeds but local recording fails, no recreation after send failure            |
| Settlement         | Manual/provider source, full/partial/refunded values if supported, failed sync preserves status, delivery remains independent                                           |
| Existing workflow  | Non-integrated member saves and manual staff edits still work; archived campaigns cannot create new contributions                                                       |
| Projections        | Candidate/member responses exclude unrelated person data, private audit fields and secrets                                                                              |

Use a stateful mocked SharePoint store that changes ETags on writes and rejects stale updates. Simple mocks that always accept writes cannot establish the concurrency behavior. Simulate remote creation followed by a lost response separately from a remote rejection.

For implementation, run `bun run test`, `bun run build` and `bun run lint` in `api/`; run `bun run build`, `bunx astro check` and `bun run lint` in `web/`. Use the SWA CLI with mocked staff identity for manual browser verification, covering desktop, mobile, keyboard navigation, family selection, state after reload, amount locks and both uncertain-operation screens. Browser tests must also use mocked payment services.

This documentation-only pass requires a diff/format review, not application tests. No build or application test result is claimed here.

## Deployment and operational acceptance

Provision columns before enabling the feature. Verify internal names, plain JSON storage, concrete ETags and any uniqueness constraint used for contribution adoption. Missing prerequisites must disable payment writes with an actionable configuration error.

Keep creation and dispatch gates on the server. Disabling them prevents new external operations while leaving stored results, manual payment controls and reconciliation available. Rollback must preserve IDs, references and audit state; reverting the UI does not undo a CampFlow contribution.

Initial staff usage should proceed one order at a time. Bulk campaign charging, automatic debits, split sibling billing, automatic reminders, refund creation and provider-person writes are outside the first release.

The implementation is ready for review when:

- A shared family order has one explicitly confirmed billing person and one final amount.
- The response ID and CampFlow reference are stored and survive reloads and redeployments.
- Repeated and concurrent requests do not dispatch another creation for the same unresolved operation.
- Every uncertain write has an actionable reconciliation path; no automatic reset or blind retry exists.
- All amount/item/person mutations respect the contribution lock on the server.
- Dispatch uses a supported method, displays its actual progress and handles uncertain results independently.
- Payment state is read through a verified API or maintained through an explicitly documented manual process with its source recorded.
- Legacy/manual orders retain their workflow and stored private metadata stays out of member responses.
- Failure, retry, concurrency and recovery tests pass entirely against simulated services.
- Deployment instructions and the later PR describe exactly which portions of issue #89 are complete and which remain manual or blocked by CampFlow's contract.
