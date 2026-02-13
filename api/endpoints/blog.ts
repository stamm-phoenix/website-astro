import { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';
import { BlogEntry, getBlogEntries } from '../lib/blog-list';
import { withErrorHandling, withEtag } from '../lib/response-utils';

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

export async function GetBlogEndpointInternal(
  request: HttpRequest,
  context: InvocationContext,
  blogEntries: BlogEntry[]
): Promise<HttpResponseInit> {
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

export default withErrorHandling(
  withEtag(GetBlogEndpointInternal, async () => {
    const blogEntries = await getBlogEntries();
    return {
      tags: blogEntries.map((b) => b.eTag),
      data: blogEntries,
    };
  })
);
