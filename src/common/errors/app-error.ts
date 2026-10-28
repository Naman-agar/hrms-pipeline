// TPRD 01 §6.1 — the one error type services throw.
//
// Services never build HTTP responses; they `throw new AppError(status, code, …)`
// with a `code` taken from the relevant TPRD's closed error-code list. The global
// filter (`src/common/filters/http-exception.filter.ts`) turns it into the
// `{ error: { code, message, fields?, details? } }` envelope.
//
// Example:
//   throw new AppError(409, 'EMAIL_TAKEN', 'email already in use', undefined, { deleted: true });

export class AppError extends Error {
  constructor(
    /** HTTP status the filter responds with (e.g. 409). */
    public readonly status: number,
    /** Machine-readable code from the TPRD error-codes section (e.g. `EMAIL_TAKEN`). */
    public readonly code: string,
    message?: string,
    /** Per-field messages, keyed by snake_case field name (validation-style errors). */
    public readonly fields?: Record<string, string>,
    /** Extra structured context for the client (e.g. `{ deleted: true, status: 'active' }`). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}
