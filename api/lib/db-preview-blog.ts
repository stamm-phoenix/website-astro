import sharp from 'sharp';
import { seedBlogWorkflow } from './blog-workflow-preview';
import { storeBlogImageFiles } from './blog-images';
import {
  addBlogImage,
  createBlogPost,
  getBlogEntries,
  getBlogEntry,
  updateBlogPost,
} from './blog-list';
import { validateBlogPost } from './validation/blog';
const PREVIEW_ACTOR = 'preview';
/** A plain test picture: a diagonal gradient in the given colors. */
export function testPicture(
  width: number,
  height: number,
  from: string,
  to: string
): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
    `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

interface PreviewPost {
  title: string;
  date: string;
  published: boolean;
  /** Text without and with the images (`{0}`, `{1}` stand for their file names). */
  content: string;
  contentWithImages?: string;
  /** Gradient colors of the test pictures. */
  images: [string, string][];
}

/** One post with images (stored in the preview's blob container), one without and a draft. */
const PREVIEW_POSTS: PreviewPost[] = [
  {
    title: 'Testbeitrag: Sommerlager',
    date: '2026-08-20',
    published: true,
    content: '<p>Dieser Beitrag ist erfunden und nur in der Preview zu sehen.</p>',
    contentWithImages:
      '<p>Dieser Beitrag ist erfunden und nur in der Preview zu sehen.</p>' +
      '<img data-bild="{1}"><p>Zweiter Absatz unter dem zweiten Bild.</p>',
    images: [
      ['#003056', '#810a1a'],
      ['#2a7a3b', '#f2b705'],
    ],
  },
  {
    title: 'Testbeitrag: Waldweihnacht',
    date: '2026-12-14',
    published: true,
    content: '<h2>Ohne Bilder</h2><p>Auch dieser Beitrag ist erfunden.</p>',
    images: [],
  },
  {
    title: 'Entwurf: Jahresrückblick',
    date: '2026-12-31',
    published: false,
    content: '<p>Noch nicht fertig.</p>',
    images: [],
  },
];

/**
 * Adds the invented posts that are missing (matched by title) and the images a post lacks,
 * e.g. after a run that stopped halfway. Image files get fixed names, so a retry overwrites
 * the files of an image that was stored but not recorded.
 */
export async function seedPreviewBlog(): Promise<void> {
  const entries = await getBlogEntries();
  const publishIds: number[] = [];
  for (const post of PREVIEW_POSTS) {
    let entry = entries.find((candidate) => candidate.title === post.title);
    if (!entry) {
      const input = { title: post.title, date: post.date, published: post.published };
      const { id } = await createBlogPost(
        validateBlogPost({ ...input, content: post.content }, []),
        PREVIEW_ACTOR
      );
      if (post.published) publishIds.push(Number(id));
      entry = await getBlogEntry(id);
      if (!entry) throw new Error(`Preview post ${id} vanished`);
    }
    // Recover publication after interruption; the workflow seeder checks preview ownership.
    if (post.published) publishIds.push(Number(entry.id));
    if (post.images.length === 0) continue;

    const files = post.images.map((_colors, index) => `bild-${1_700_000_000_000 + index}.jpg`);
    let etag = entry.etag;
    for (const [index, [from, to]] of post.images.entries()) {
      if (entry.images.some((image) => image.file === files[index])) continue;
      const image = {
        file: files[index],
        alt: `Testbild ${index + 1}`,
        width: 1600,
        height: 1067,
      };
      if (post.published) publishIds.push(Number(entry.id));
      await storeBlogImageFiles(entry.id, image, await testPicture(1600, 1067, from, to));
      etag = (await addBlogImage(entry.id, image, etag, PREVIEW_ACTOR)).etag;
    }
    if (post.contentWithImages && !entry.content.includes('data-bild')) {
      const content = files.reduce(
        (text, file, index) => text.replaceAll(`{${index}}`, file),
        post.contentWithImages
      );
      if (post.published) publishIds.push(Number(entry.id));
      await updateBlogPost(
        entry.id,
        validateBlogPost(
          { title: post.title, date: post.date, published: post.published, content },
          files
        ),
        etag,
        PREVIEW_ACTOR
      );
    }
  }
  await seedBlogWorkflow(publishIds);
}
