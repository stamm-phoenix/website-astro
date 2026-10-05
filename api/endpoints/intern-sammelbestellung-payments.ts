import { pflegeHandler, ok, NOT_FOUND, readJsonBody } from '../lib/pflege-api';
import { validateSammelPaymentInput } from '../lib/pflege-validation';
import { CampflowError } from '../lib/campflow';
import { campflowErrorResponse } from '../lib/campflow-api';
import { errorResponse } from '../lib/response-utils';
import { getSammelOrder, getSammelCampaign } from '../lib/sammelbestellung-list';
import { requireSammelVersion, sammelHandler } from './sammelbestellungen';
import {
  SammelPaymentError,
  sammelPaymentView,
  sammelBillingPersons,
  requireSammelPaymentStorage,
  assignSammelBillingPerson,
  sammelBillingPreview,
  createSammelContribution,
  adoptSammelContribution,
  confirmSammelPaymentDispatch,
} from '../lib/sammelbestellung-payments';

/** Staff authentication happens in pflegeHandler before any provider or order read. */
export const SammelStaffPayment = sammelHandler(
  pflegeHandler('sammelbestellungen-zahlung', async (request, context, principal) => {
    // SWA ends the entire API request at 45 seconds; leave five seconds of gateway margin.
    const deadline = Date.now() + 40_000;
    try {
      const order = await getSammelOrder(request.params.id);
      const campaign = order ? await getSammelCampaign(order.campaignId) : undefined;
      if (!order || !campaign) return NOT_FOUND;
      if (request.method === 'GET') return ok(sammelPaymentView(order));
      const input = validateSammelPaymentInput(await readJsonBody(request));
      const conflict = requireSammelVersion(input.etag, order.etag);
      if (conflict) return conflict;
      if (input.action === 'preview') {
        // An unresolved operation keeps its original snapshot, including after campaign archival.
        const operation = order.paymentRecord?.operation;
        if (operation)
          return ok({
            etag: order.etag,
            snapshot: operation.snapshot,
            hash: operation.hash,
            personName: order.paymentRecord!.assignment.person.name,
          });
        return ok(sammelBillingPreview(order, campaign, true));
      }
      await requireSammelPaymentStorage();
      switch (input.action) {
        case 'assign':
          await assignSammelBillingPerson(order, campaign, input.personId, input.reason, principal);
          break;
        case 'create':
          await createSammelContribution(order, campaign, input.hash, principal, { deadline });
          break;
        case 'adopt':
          await adoptSammelContribution(
            order,
            campaign,
            input.hash,
            { id: input.feeId, reference: input.reference },
            input.evidence,
            principal
          );
          break;
        case 'dispatched':
          await confirmSammelPaymentDispatch(order, input.evidence, principal);
          break;
      }
      const updated = await getSammelOrder(order.id);
      if (!updated) return NOT_FOUND;
      return ok(sammelPaymentView(updated));
    } catch (error: unknown) {
      if (error instanceof SammelPaymentError) {
        context.log(
          `[sammelbestellungen-zahlung] ${principal.userId} ${request.params.id} ${error.code}`
        );
        return errorResponse(error.status, error.code, error.message);
      }
      if (error instanceof CampflowError) return campflowErrorResponse(error);
      throw error;
    }
  })
);

export const SammelStaffPaymentPersons = sammelHandler(
  pflegeHandler('sammelbestellungen-personen', async (request) => {
    const order = await getSammelOrder(request.params.id);
    if (!order) return NOT_FOUND;
    try {
      return ok(await sammelBillingPersons(order));
    } catch (error: unknown) {
      if (error instanceof CampflowError) return campflowErrorResponse(error);
      throw error;
    }
  })
);
