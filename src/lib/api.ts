const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) {
    throw new ApiError(response.status, `API error: ${response.statusText}`);
  }
  return response.json();
}

export function getLeaderImageUrl(id: string): string {
  return `${API_BASE}/leitende/${id}/image`;
}

/**
 * Sanitizes HTML content from SharePoint by:
 * 1. Removing the outer ExternalClass wrapper div
 * 2. Stripping inline styles
 * 3. Removing empty elements
 * 4. Allowing only safe HTML tags
 */
export function sanitizeDescription(html: string): string {
  if (!html || typeof html !== 'string') return '';

  // Create a temporary element to parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Find the content - skip ExternalClass wrapper if present
  let content = doc.body;
  const externalWrapper = doc.querySelector('[class^="ExternalClass"]');
  if (externalWrapper) {
    content = externalWrapper as HTMLElement;
  }

  // Recursive function to clean nodes
  function cleanNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      // Keep text nodes, trim zero-width spaces
      const text = node.textContent?.replace(/[\u200B-\u200D\uFEFF]/g, '') || '';
      return text ? document.createTextNode(text) : null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();

    // Allowed tags
    const allowedTags = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'div', 'span', 'ul', 'ol', 'li'];

    if (!allowedTags.includes(tagName)) {
      // For disallowed tags, just return their text content
      const text = el.textContent?.trim();
      return text ? document.createTextNode(text) : null;
    }

    // Create clean element without attributes (removes inline styles)
    const cleanEl = document.createElement(tagName);

    // Process children
    for (const child of Array.from(el.childNodes)) {
      const cleanChild = cleanNode(child);
      if (cleanChild) {
        cleanEl.appendChild(cleanChild);
      }
    }

    // Skip empty elements (except br)
    if (tagName !== 'br' && !cleanEl.textContent?.trim()) {
      return null;
    }

    return cleanEl;
  }

  // Clean and collect content
  const result = document.createElement('div');
  for (const child of Array.from(content.childNodes)) {
    const cleanChild = cleanNode(child);
    if (cleanChild) {
      result.appendChild(cleanChild);
    }
  }

  return result.innerHTML;
}
