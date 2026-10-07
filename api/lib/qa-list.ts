import type { Selectable } from 'kysely';
import { sql } from 'kysely';
import type { FaqTable } from './db-schema';
import {
  RecordNotFoundError,
  VersionConflictError,
  getDb,
  parseId,
  requireVersion,
  toVersion,
} from './db';
import type { QuestionAndAnswerInput } from './pflege-validation';

/**
 * Questions and answers in Azure SQL (`content.faq`, migration `0003_blog_faq.sql`).
 */
export interface QuestionAndAnswer {
  id: string;
  question: string;
  answer: string;
  category: string;
}

/** An entry as the Leitendenbereich edits it, drafts included. */
export interface StaffQuestionAndAnswer extends QuestionAndAnswerInput {
  id: string;
  etag: string;
}

function toStaffItem(row: Selectable<FaqTable>): StaffQuestionAndAnswer {
  return {
    id: String(row.id),
    etag: toVersion(row.version),
    question: row.question,
    answer: row.answer,
    category: row.category,
    published: row.published,
  };
}

/** All entries in the order they were created. */
export async function getStaffQuestionsAndAnswers(): Promise<StaffQuestionAndAnswer[]> {
  const rows = await getDb().selectFrom('content.faq').selectAll().orderBy('id').execute();
  return rows.map(toStaffItem);
}

/** The published entries for the public FAQ. */
export async function getQuestionsAndAnswers(): Promise<QuestionAndAnswer[]> {
  const rows = await getDb()
    .selectFrom('content.faq')
    .select(['id', 'question', 'answer', 'category'])
    .where('published', '=', true)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: String(row.id),
    question: row.question,
    answer: row.answer,
    category: row.category,
  }));
}

/** The topics in use, offered as suggestions in the form. */
export async function getQuestionCategories(): Promise<string[]> {
  const rows = await getDb().selectFrom('content.faq').select('category').distinct().execute();
  return rows.map((row) => row.category).sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * The spelling of a topic in use that differs from `category` only in case, or `category`
 * itself for a new topic, so the public FAQ never splits one topic into two groups. Compared
 * explicitly, as the database collation decides only which spelling `DISTINCT` returns.
 */
async function canonicalCategory(category: string): Promise<string> {
  const rows = await getDb().selectFrom('content.faq').select('category').distinct().execute();
  const same = rows
    .map((row) => row.category)
    .filter((existing) => existing.localeCompare(category, 'de', { sensitivity: 'accent' }) === 0);
  return same.includes(category) ? category : (same.sort()[0] ?? category);
}

async function toColumns(input: QuestionAndAnswerInput, actor: string) {
  return {
    question: input.question,
    answer: input.answer,
    category: await canonicalCategory(input.category),
    published: input.published,
    updated_by: actor,
  };
}

export async function createQuestionAndAnswer(
  input: QuestionAndAnswerInput,
  actor: string
): Promise<string> {
  const { id } = await getDb()
    .insertInto('content.faq')
    .values(await toColumns(input, actor))
    .output('inserted.id')
    .executeTakeFirstOrThrow();
  return String(id);
}

async function notChanged(id: number): Promise<never> {
  const exists = await getDb()
    .selectFrom('content.faq')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  throw exists ? new VersionConflictError() : new RecordNotFoundError();
}

/** Saves an entry if it still has the version `etag`. */
export async function updateQuestionAndAnswer(
  id: string,
  input: QuestionAndAnswerInput,
  etag: string,
  actor: string
): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const result = await getDb()
    .updateTable('content.faq')
    .set({ ...(await toColumns(input, actor)), updated_at: sql<Date>`SYSUTCDATETIME()` })
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) await notChanged(numericId);
}

/** Deletes an entry if it still has the version `etag`. */
export async function deleteQuestionAndAnswer(id: string, etag: string): Promise<void> {
  const numericId = parseId(id);
  if (numericId === undefined) throw new RecordNotFoundError();
  const result = await getDb()
    .deleteFrom('content.faq')
    .where('id', '=', numericId)
    .where('version', '=', requireVersion(etag))
    .executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) await notChanged(numericId);
}
