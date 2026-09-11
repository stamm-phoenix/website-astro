import { getSharePointListItems } from './sharepoint-data-access';
import { EnvironmentVariable, getEnvironment } from './environment';

export interface QuestionAndAnswer {
  id: string;
  question: string;
  answer: string;
  category: string;
}

interface SharePointQuestionFields {
  Title?: string;
  Antwort?: string;
  Kategorie?: string;
}

interface SharePointQuestionItem {
  id: string;
  fields: SharePointQuestionFields;
}

/**
 * Validates that an untrusted Graph list item contains fields suitable for a Q&A entry.
 *
 * @param item - The untrusted value to validate
 * @returns `true` if the item has a string ID, string question and answer fields, and a valid optional category, `false` otherwise.
 */
function isSharePointQuestionItem(item: unknown): item is SharePointQuestionItem {
  if (typeof item !== 'object' || item === null) return false;

  const candidate = item as { id?: unknown; fields?: unknown };
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.fields !== 'object' ||
    candidate.fields === null
  ) {
    return false;
  }

  const fields = candidate.fields as Record<string, unknown>;
  return (
    typeof fields.Title === 'string' &&
    typeof fields.Antwort === 'string' &&
    (fields.Kategorie === undefined ||
      fields.Kategorie === null ||
      typeof fields.Kategorie === 'string')
  );
}

/**
 * Reads valid Q&A rows from SharePoint and normalizes uncategorized rows.
 * @returns Q&A entries safe for the public API response.
 */
export async function getQuestionsAndAnswers(): Promise<QuestionAndAnswer[]> {
  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_QA_LIST_ID);
  const items = await getSharePointListItems(listId, { expand: 'fields' });

  return items
    .map((item: unknown): QuestionAndAnswer | null => {
      if (!isSharePointQuestionItem(item)) return null;

      const question = item.fields.Title?.trim();
      const answer = item.fields.Antwort?.trim();

      if (!question || !answer) return null;

      return {
        id: item.id,
        question,
        answer,
        category: item.fields.Kategorie?.trim() || 'Allgemein',
      };
    })
    .filter((item): item is QuestionAndAnswer => item !== null);
}
