import { errorMessage, fetchFile } from './api';

/** A page (from 1) of a CampFlow receipt as PNG, with the receipt's page count. */
export async function fetchCampflowBelegBild(
  receiptNumber: string,
  page: number
): Promise<{ blob: Blob; pages: number }> {
  try {
    const file = await fetchFile(
      `/intern/abrechnung/belege/${encodeURIComponent(receiptNumber)}/bild?page=${page}`
    );
    return { blob: file.blob, pages: Number(file.headers.get('x-campflow-pages')) || 1 };
  } catch (error: unknown) {
    throw new Error(errorMessage(error, 'keine Verbindung'), {
      cause: error,
    });
  }
}
