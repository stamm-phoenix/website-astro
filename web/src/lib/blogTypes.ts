import type { BlogWorkflow } from '../../../api/lib/blog-workflow-model';
/** An image attached to a blog post; the first one is the cover image. */
export interface BlogImage {
  file: string;
  alt: string;
  width: number;
  height: number;
}

/** A blog post in the list of the Leitendenbereich, including drafts. */
export interface StaffBlogListItem {
  workflow?: BlogWorkflow;
  id: string;
  title: string;
  date: string;
  published: boolean;
  cover: BlogImage | null;
  imageCount: number;
  textLength: number;
}

/** A blog post as edited in the Leitendenbereich. */
export interface StaffBlogPost {
  workflow?: BlogWorkflow;
  id: string;
  /** Version of the item as loaded; sent back on save to detect concurrent changes. */
  etag: string;
  title: string;
  date: string;
  published: boolean;
  /** Canonical HTML with `<img data-bild="…">` placeholders for the images. */
  content: string;
  images: BlogImage[];
}
