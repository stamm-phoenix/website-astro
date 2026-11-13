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
export interface StaffQuestionAndAnswer {
  id: string;
  etag: string;
  published: boolean;
  question: string;
  answer: string;
  category: string;
}
