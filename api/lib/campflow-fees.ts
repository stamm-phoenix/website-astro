import { EnvironmentVariable, getEnvironment } from './environment';
import type { SammelBillingSnapshot, SammelContribution } from './sammelbestellung-payment-model';

/** Every failure after dispatch is conservatively ambiguous. Never retry a fee POST. */
export class CampflowFeeUncertainError extends Error {
  constructor(public category: string) {
    super('Das Ergebnis der Beitragserstellung ist unklar. Bitte in CampFlow prüfen.');
    this.name = 'CampflowFeeUncertainError';
  }
}

/** The public API accepts an array even when creating a single contribution. */
export async function createCampflowFee(
  snapshot: SammelBillingSnapshot
): Promise<SammelContribution> {
  const token = getEnvironment(EnvironmentVariable.CAMPFLOW_API_TOKEN);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch('https://api.campflow.de/fees', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [
          {
            amount: snapshot.amount,
            description: snapshot.description,
            person_id: snapshot.personId,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (response.status !== 201) throw new CampflowFeeUncertainError(`http_${response.status}`);
    const body: unknown = await response.json();
    const data =
      body && typeof body === 'object' ? (body as Record<string, unknown>).data : undefined;
    if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object')
      throw new CampflowFeeUncertainError('invalid_response');
    const result = data[0] as Record<string, unknown>;
    if (
      typeof result.id !== 'string' ||
      !/^fee_[A-Za-z0-9]{1,240}$/.test(result.id) ||
      typeof result.reference !== 'string' ||
      !result.reference.trim() ||
      result.reference.length > 100 ||
      result.amount !== snapshot.amount ||
      result.description !== snapshot.description ||
      result.person_id !== snapshot.personId
    )
      throw new CampflowFeeUncertainError('mismatched_response');
    return { id: result.id, reference: result.reference };
  } catch (error: unknown) {
    if (error instanceof CampflowFeeUncertainError) throw error;
    throw new CampflowFeeUncertainError(
      controller.signal.aborted ? 'timeout' : 'transport_or_json'
    );
  } finally {
    clearTimeout(timeout);
  }
}
