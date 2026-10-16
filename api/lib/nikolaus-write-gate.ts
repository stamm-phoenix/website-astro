import { getNikolausSettings } from './nikolaus-settings';

/** All Nikolaus writes are stopped (maintenance mode in the Steuerung). */
export class NikolausMaintenanceError extends Error {
  readonly statusCode = 503;
  readonly code = 'MAINTENANCE';

  constructor() {
    super(
      // Families and Leitende both see it, so it addresses nobody directly
      'Wegen einer kurzen Wartung kann gerade nichts gespeichert werden; die Eingaben sind noch nicht gespeichert. Bitte in einer Stunde noch einmal versuchen oder an kontakt@stamm-phoenix.de schreiben.'
    );
    this.name = 'NikolausMaintenanceError';
  }
}

/** Whether Nikolaus writes are allowed, i.e. the maintenance mode is off. */
export async function nikolausWritesEnabled(): Promise<boolean> {
  return !(await getNikolausSettings()).maintenance;
}

/**
 * Runs a mutating Nikolaus operation unless the maintenance mode stops all writes. The
 * Steuerung itself and its deletions are not gated: they must work to end the maintenance.
 */
export async function runWithNikolausWriteGate<T>(handler: () => Promise<T>): Promise<T> {
  if (!(await nikolausWritesEnabled())) throw new NikolausMaintenanceError();
  return handler();
}
