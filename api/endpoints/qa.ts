import type { HttpResponseInit } from '@azure/functions';
import { getQuestionsAndAnswers } from '../lib/qa-list';
import { withErrorHandling } from '../lib/response-utils';

export async function GetQuestionsAndAnswersEndpoint(): Promise<HttpResponseInit> {
  return {
    status: 200,
    jsonBody: await getQuestionsAndAnswers(),
  };
}

export default withErrorHandling(GetQuestionsAndAnswersEndpoint);
