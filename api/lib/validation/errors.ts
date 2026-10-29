/** Field errors of a rejected input, keyed by the name of the form field. */
export type FieldErrors = Record<string, string>;

/** Thrown by the validators; the Pflege handlers answer it with `400` and the field messages. */
export class ValidationError extends Error {
  constructor(public fields: FieldErrors) {
    super('Die Eingaben sind unvollständig oder ungültig.');
    this.name = 'ValidationError';
  }
}
