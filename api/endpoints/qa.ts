import type { HttpResponseInit } from '@azure/functions';
import { getQuestionsAndAnswers } from '../lib/qa-list';
import { withErrorHandling } from '../lib/response-utils';

/**
 * Retrieves the normalized SharePoint Q&A collection through an HTTP endpoint.
 *
 * @returns An HTTP response with status 200 and the Q&A collection as its JSON body.
 */
export async function GetQuestionsAndAnswersEndpoint(): Promise<HttpResponseInit> {
  return {
    status: 200,
    jsonBody: await getQuestionsAndAnswers(),
  };
}

export default withErrorHandling(GetQuestionsAndAnswersEndpoint, { exposeErrorDetails: false });
