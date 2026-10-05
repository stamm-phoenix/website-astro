import type { HttpRequest } from '@azure/functions';
import { isQuestionPublished } from '../lib/qa-list';
import { CONFIG } from '../lib/config';
import {
  createSharePointListItem,
  deleteSharePointListItem,
  getSharePointListItems,
  getSharePointListColumns,
  updateSharePointListItem,
} from '../lib/sharepoint-data-access';
import type { QuestionAndAnswerInput } from '../lib/pflege-validation';
import {
  sanitizeRichText,
  validateQuestionAndAnswer,
  ValidationError,
} from '../lib/pflege-validation';
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

interface StaffQuestionAndAnswer extends QuestionAndAnswerInput {
  id: string;
  etag: string;
}

interface CategoryOptions {
  categories: string[];
  allowCustomCategories: boolean;
}

/** Reads whether the SharePoint category column allows arbitrary text or fixed choices. */
async function categoryOptions(): Promise<CategoryOptions> {
  const columns = await getSharePointListColumns(listId());
  for (const value of columns) {
    if (!value || typeof value !== 'object') continue;
    const column = value as Record<string, unknown>;
    if (column.name !== 'Kategorie' || !column.choice || typeof column.choice !== 'object')
      continue;
    const choice = column.choice as Record<string, unknown>;
    return {
      categories: Array.isArray(choice.choices)
        ? choice.choices.filter((value): value is string => typeof value === 'string')
        : [],
      allowCustomCategories: choice.allowTextEntry === true,
    };
  }
  return { categories: [], allowCustomCategories: true };
}

async function readInput(body: unknown): Promise<QuestionAndAnswerInput> {
  const input = validateQuestionAndAnswer(body);
  const options = await categoryOptions();
  if (!options.allowCustomCategories && !options.categories.includes(input.category)) {
    throw new ValidationError({ category: 'Bitte ein vorhandenes Thema auswählen.' });
  }
  return input;
}

function listId(): string {
  return CONFIG.sharepoint.lists.qa;
}

function toFields(input: QuestionAndAnswerInput): Record<string, unknown> {
  return {
    Title: input.question,
    Antwort: input.answer,
    Kategorie: input.category,
    Veroeffentlicht: input.published,
  };
}

/** Includes incomplete entries so staff can repair rows absent from the public FAQ. */
function toStaffItem(value: unknown): StaffQuestionAndAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !/^\d+$/.test(item.id)) return null;
  const fields =
    item.fields && typeof item.fields === 'object' ? (item.fields as Record<string, unknown>) : {};
  return {
    id: item.id,
    published: isQuestionPublished(fields.Veroeffentlicht),
    etag: typeof item.eTag === 'string' ? item.eTag : '',
    question: typeof fields.Title === 'string' ? fields.Title : '',
    answer: sanitizeRichText(typeof fields.Antwort === 'string' ? fields.Antwort : ''),
    category:
      typeof fields.Kategorie === 'string' ? fields.Kategorie.trim() || 'Allgemein' : 'Allgemein',
  };
}

/** GET: all FAQ entries; POST: create a question and answer with its publication status. */
export const QuestionsCollectionEndpoint = pflegeHandler('faq', async (request: HttpRequest) => {
  if (request.method === 'GET') {
    const [items, options] = await Promise.all([
      getSharePointListItems(listId(), { expand: 'fields' }),
      categoryOptions(),
    ]);
    return ok({ items: items.map(toStaffItem).filter((item) => item !== null), ...options });
  }
  if (request.method !== 'POST') return METHOD_NOT_ALLOWED;

  const input = await readInput(await readJsonBody(request));
  const id = await createSharePointListItem(listId(), toFields(input));
  return ok({ id }, 201);
});

/** PATCH/DELETE: change the loaded version of a FAQ entry; concurrent changes return 409. */
export const QuestionItemEndpoint = pflegeHandler('faq', async (request: HttpRequest) => {
  const id = request.params.id ?? '';
  if (!/^\d+$/.test(id)) return NOT_FOUND;

  if (request.method === 'DELETE') {
    await deleteSharePointListItem(listId(), id, requireVersion(readIfMatch(request)));
    return NO_CONTENT;
  }
  if (request.method !== 'PATCH') return METHOD_NOT_ALLOWED;

  const body = await readJsonBody(request);
  const input = await readInput(body);
  await updateSharePointListItem(listId(), id, toFields(input), requireVersion(readEtag(body)));
  return NO_CONTENT;
});

export const QuestionsCollection = withErrorHandling(QuestionsCollectionEndpoint);
export const QuestionItem = withErrorHandling(QuestionItemEndpoint);
