import { app, type HttpRequest } from '@azure/functions';
import {
  createQuestionAndAnswer,
  deleteQuestionAndAnswer,
  getQuestionCategories,
  getStaffQuestionsAndAnswers,
  updateQuestionAndAnswer,
} from '../lib/qa-list';
import { validateQuestionAndAnswer } from '../lib/validation/content';
import { NOT_FOUND, NO_CONTENT, ok, readEtag, readIfMatch, requireEtag } from '../lib/pflege-api';
import { readJsonBody } from '../lib/response-utils';
import { staffHandler } from '../lib/handler';

/**
 * GET: all FAQ entries with the topics in use (any new topic is allowed); POST: create a
 * question and answer with its publication status.
 */
export const QuestionsCollection = staffHandler(
  'faq',
  async (request: HttpRequest, _context, principal) => {
    if (request.method === 'GET') {
      const items = await getStaffQuestionsAndAnswers();
      return ok({ items, categories: getQuestionCategories(items), allowCustomCategories: true });
    }

    const input = validateQuestionAndAnswer(await readJsonBody(request));
    return ok({ id: await createQuestionAndAnswer(input, principal.userDetails) }, 201);
  }
);

/** PATCH/DELETE: change the loaded version of a FAQ entry; concurrent changes return 409. */
export const QuestionItem = staffHandler(
  'faq',
  async (request: HttpRequest, _context, principal) => {
    const id = request.params.id ?? '';
    if (!/^\d+$/.test(id)) return NOT_FOUND;

    if (request.method === 'DELETE') {
      await deleteQuestionAndAnswer(id, requireEtag(readIfMatch(request)));
      return NO_CONTENT;
    }

    const body = await readJsonBody(request);
    const input = validateQuestionAndAnswer(body);
    await updateQuestionAndAnswer(id, input, requireEtag(readEtag(body)), principal.userDetails);
    return NO_CONTENT;
  }
);

// Edit modules of the Leitendenbereich (write to SharePoint)
app.http('internPflegeQuestions', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'intern/pflege/qa',
  handler: QuestionsCollection,
});

app.http('internPflegeQuestion', {
  methods: ['PATCH', 'DELETE'],
  authLevel: 'anonymous',
  route: 'intern/pflege/qa/{id}',
  handler: QuestionItem,
});
