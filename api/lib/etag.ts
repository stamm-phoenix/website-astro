import { createHash } from "crypto";

export function generateETag(tags: string[]): string {
  const combined = tags.sort().join("|");
  return `W/"${createHash("md5").update(combined).digest("hex")}"`;
}

export function isNotModified(requestETag: string | null | undefined, currentETag: string): boolean {
  if (!requestETag) return false;
  return requestETag === currentETag;
}
