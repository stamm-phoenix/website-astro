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

export async function getQuestionsAndAnswers(): Promise<QuestionAndAnswer[]> {
  const listId = getEnvironment(EnvironmentVariable.SHAREPOINT_QA_LIST_ID);
  const items = await getSharePointListItems(listId, { expand: 'fields' });

  return items
    .map((item: unknown): QuestionAndAnswer | null => {
      const listItem = item as SharePointQuestionItem;
      const question = listItem.fields.Title?.trim();
      const answer = listItem.fields.Antwort?.trim();

      if (!question || !answer) return null;

      return {
        id: listItem.id,
        question,
        answer,
        category: listItem.fields.Kategorie?.trim() || 'Allgemein',
      };
    })
    .filter((item): item is QuestionAndAnswer => item !== null);
}
