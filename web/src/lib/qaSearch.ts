import { parseHtml } from './html';
import type { QuestionAndAnswer } from '../../../api/lib/qa-model';

export interface QuestionSearchEntry {
  item: QuestionAndAnswer;
  text: string;
}

function normalize(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

/** Index only visible text, keeping words in adjacent paragraphs separate. */
export function createQuestionIndex(items: QuestionAndAnswer[]): QuestionSearchEntry[] {
  return items.map((item) => {
    const doc = parseHtml(item.answer);
    doc.querySelectorAll('script, style, template').forEach((node) => node.remove());
    doc.querySelectorAll('p, li, br, div, h2, h3').forEach((node) => node.prepend(' '));
    return {
      item,
      text: normalize(`${item.question} ${item.category} ${doc.body.textContent ?? ''}`),
    };
  });
}

function terms(query: string): string[] {
  return [...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

/** Explicit search requires every word; an empty query restores the list. */
export function searchQuestions(index: QuestionSearchEntry[], query: string): QuestionAndAnswer[] {
  const words = terms(query);
  return index
    .filter(({ text }) => words.every((word) => text.includes(word)))
    .map(({ item }) => item);
}

const COMMON_WORDS = new Set(
  'aber alle auch bitte brauche danke dass dein deine dem den der des die dort durch ein eine einem einen einer eines einmal erst etwas euch fur gern gerne gibt habe haben hallo hier ich ihr ihre ist kann konnen kind kinder mein meine mit mochte nach nicht noch oder seid sein sind uns unser unsere und vom von vor wann warum was welche welcher welches wenn wer werden wie wir wurde zum zur'.split(
    ' '
  )
);

/** Rank useful words from a free-form message, without requiring the whole message to match. */
export function suggestQuestions(
  index: QuestionSearchEntry[],
  message: string,
  limit = 3
): QuestionAndAnswer[] {
  const words = terms(message).filter((word) => word.length >= 4 && !COMMON_WORDS.has(word));
  if (!words.length) return [];
  return index
    .map((entry) => ({ ...entry, score: words.filter((word) => entry.text.includes(word)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
