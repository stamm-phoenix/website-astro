import { createQuestionAndAnswer, getStaffQuestionsAndAnswers } from './qa-list';
import { validateQuestionAndAnswer } from './validation/content';
const PREVIEW_ACTOR = 'preview';

/** Invented questions; one draft shows the publication status. */
const PREVIEW_FAQ = [
  {
    question: 'Ab welchem Alter kann man mitmachen?',
    answer: '<p>Die Wölflinge starten mit <strong>sieben Jahren</strong>.</p>',
    category: 'Mitmachen',
    published: true,
  },
  {
    question: 'Was kostet eine Mitgliedschaft?',
    answer:
      '<p>Der Beitrag ist ein Testwert der Preview. Fragen dazu an <a href="mailto:kontakt@stamm-phoenix.de">kontakt@stamm-phoenix.de</a>.</p>',
    category: 'Mitgliedschaft',
    published: true,
  },
  {
    question: 'Was ziehe ich zur Gruppenstunde an?',
    answer: '<p>Etwas, das dreckig werden darf.</p>',
    category: 'Gruppenstunden',
    published: true,
  },
  {
    question: 'Entwurf: Wie läuft das Sommerlager ab?',
    answer: '',
    category: 'Lager',
    published: false,
  },
];

/** Adds the invented questions that are missing (matched by question). */
export async function seedPreviewQuestions(): Promise<void> {
  const existing = new Set((await getStaffQuestionsAndAnswers()).map((entry) => entry.question));
  for (const entry of PREVIEW_FAQ) {
    if (existing.has(entry.question)) continue;
    await createQuestionAndAnswer(validateQuestionAndAnswer(entry), PREVIEW_ACTOR);
  }
}
