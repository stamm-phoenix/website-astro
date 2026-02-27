import type { HttpResponseInit } from '@azure/functions';
import { getBlogEntries } from '../lib/blog-list';
import { withErrorHandling } from '../lib/response-utils';

interface BlogData {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  hasImage: boolean;
}

export async function GetBlogEndpoint(): Promise<HttpResponseInit> {
  const blogEntries = await getBlogEntries();

  const data = blogEntries.map((b): BlogData => {
    return {
      id: b.id,
      title: b.title,
      content: b.content,
      hasImage: b.hasImage,
      createdBy: b.createdBy,
      createdAt: b.createdAt,
      lastModifiedBy: b.lastModifiedBy,
      lastModifiedAt: b.lastModifiedAt,
    };
  });

  return {
    status: 200,
    jsonBody: data,
  };
}

export default withErrorHandling(GetBlogEndpoint);
