// Unknown-error rendering. Thrown values are not always Errors, and the shape of
// "give me something printable" is written once here.

export function errText(error: unknown): string {
  return String((error as Error)?.message ?? error);
}
