/** A calendar entry as the edit module loads it. */
export interface StaffAktion {
  id: string;
  etag: string;
  campflowId: string | null;
  title: string;
  stufen: string[];
  start: string;
  end: string;
  link: string;
  description: string;
  meetingPoint?: string;
  packingList?: string[];
  downloadIds?: string[];
}
