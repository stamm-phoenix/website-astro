/** All Nikolaus writes are stopped (emergency switch `NIKOLAUS_WRITES_ENABLED`). */
export class NikolausMaintenanceError extends Error {
  readonly statusCode = 503;
  readonly code = 'MAINTENANCE';

  constructor() {
    super('Der Nikolausdienst wird gewartet. Bitte versuchen Sie es später erneut.');
    this.name = 'NikolausMaintenanceError';
  }
}

/** Whether Nikolaus writes are allowed; a missing or other value than "true" stops them. */
export function nikolausWritesEnabled(): boolean {
  return process.env.NIKOLAUS_WRITES_ENABLED === 'true';
}

/**
 * Runs a mutating Nikolaus operation unless the emergency switch stops all writes. The
 * retention run needs no gate: it deletes in one transaction, and writers that loaded a row
 * before get a version conflict.
 */
export async function runWithNikolausWriteGate<T>(handler: () => Promise<T>): Promise<T> {
  if (!nikolausWritesEnabled()) throw new NikolausMaintenanceError();
  return handler();
}
