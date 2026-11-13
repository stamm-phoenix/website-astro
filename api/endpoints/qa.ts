import { app, type HttpResponseInit } from '@azure/functions';
import { getQuestionsAndAnswers } from '../lib/qa-list';
import { publicHandler } from '../lib/handler';

/** The published questions and answers. */
export async function GetQuestionsAndAnswersEndpoint(): Promise<HttpResponseInit> {
  return {
    status: 200,
    jsonBody: await getQuestionsAndAnswers(),
  };
}

const defaultHandler = publicHandler(GetQuestionsAndAnswersEndpoint, {
  exposeErrorDetails: false,
});
export default defaultHandler;

app.http('qa', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: defaultHandler,
});
