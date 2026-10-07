import type { HttpRequest } from '@azure/functions';
import {
  createQuestionAndAnswer,
  deleteQuestionAndAnswer,
  getQuestionCategories,
  getStaffQuestionsAndAnswers,
  updateQuestionAndAnswer,
} from '../lib/qa-list';
import { validateQuestionAndAnswer } from '../lib/pflege-validation';
import {
  METHOD_NOT_ALLOWED,
  NOT_FOUND,
  NO_CONTENT,
  ok,
  pflegeHandler,
  readEtag,
  requireVersion,
  readIfMatch,
  readJsonBody,
} from '../lib/pflege-api';
import { withErrorHandling } from '../lib/response-utils';

/**
 * GET: all FAQ entries with the topics in use (any new topic is allowed); POST: create a
 * question and answer with its publication status.
 */
export const QuestionsCollectionEndpoint = pflegeHandler(
  'faq',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const [items, categories] = await Promise.all([
        getStaffQuestionsAndAnswers(),
        getQuestionCategories(),
      ]);
      return ok({ items, categories, allowCustomCategories: true });
    }
    if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

    const input = validateQuestionAndAnswer(await readJsonBody(request));
    return ok({ id: await createQuestionAndAnswer(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of a FAQ entry; concurrent changes return 409. */
export const QuestionItemEndpoint = pflegeHandler(
  'faq',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteQuestionAndAnswer(id, requireVersion(readIfMatch(request)));
      return NO_CONTENT;
    }
    if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

    const body = await readJsonBody(request);
    const input = validateQuestionAndAnswer(body);
    await updateQuestionAndAnswer(id, input, requireVersion(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

export const QuestionsCollection = withErrorHandling(QuestionsCollectionEndpoint);
export const QuestionItem = withErrorHandling(QuestionItemEndpoint);
