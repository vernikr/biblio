import type { SourceId } from "../types.js";
import { errText } from "../errors.js";
import { ResourceNotFoundError } from "../http.js";
import { NUMBER_SETTINGS, readNumber } from "../config.js";

const FAILURE_THRESHOLD = 3;

/** How long a source stays skipped once it trips. Shares the mirror cooldown
 *  setting, since both mean "stop asking this for a while". */
const COOLDOWN_MS = readNumber(NUMBER_SETTINGS.mirrorDeadTtlMs);

type CircuitState = {
  consecutiveFailures: number;
  openedAt?: number;
  reason?: string;
};

const circuits = new Map<SourceId, CircuitState>();

class SourceCircuitOpenError extends Error {
  readonly source: SourceId;

  constructor(source: SourceId, message: string) {
    super(message);
    this.name = "SourceCircuitOpenError";
    this.source = source;
  }
}

function errorMessage(error: unknown): string {
  return errText(error);
}

/** Convert mirror-level diagnostics into a short, actionable source error. */
export function summarizeSourceFailure(source: SourceId, error: unknown): string {
  if (error instanceof SourceCircuitOpenError) return error.message;
  if (error instanceof ResourceNotFoundError) return error.message;

  const message = errorMessage(error);
  const mirrors = message.match(/All\s+(\d+)\s+[\w-]+\s+mirror\(s\)\s+failed/i)?.[1];
  if (source === "scihub" && /human-verification challenge/i.test(message)) {
    return "unavailable — Sci-Hub asked for a human check on every mirror that answered; try again later";
  }
  if (source === "annas" && /(?:HTTP\s+403|\bforbidden\b|DDoS.?Guard)/i.test(message)) {
    const count = mirrors ? ` (${mirrors})` : "";
    return (
      `unavailable — DDoS-Guard challenge on all configured Anna's Archive mirrors${count}; ` +
      "retry later or set BIBLIO_ANNAS_API_KEY for member fast downloads"
    );
  }
  if (source === "annas" && /not Anna's Archive|parked or hijacked/i.test(message)) {
    return `unavailable — all ${mirrors ?? "configured"} Anna's Archive mirror(s) returned a non-archive page; run healthcheck or retry later`;
  }
  if (mirrors) {
    return `unavailable — all ${mirrors} ${source} mirror(s) failed; run healthcheck or retry later`;
  }

  // URLs and long mirror-by-mirror lists do not help the caller decide what to
  // do. Keep one sanitized hint for errors that do not follow our mirror format.
  const concise = message
    .replace(/https?:\/\/\S+/g, "mirror")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return concise ? `unavailable — ${concise}` : "unavailable — source request failed";
}

/** The open state is live only inside its cooldown window. */
function activeOpen(state: CircuitState | undefined, now: number): boolean {
  return state?.openedAt !== undefined && now - state.openedAt < COOLDOWN_MS;
}

function openMessage(source: SourceId, reason: string): string {
  const minutes = Math.max(1, Math.round(COOLDOWN_MS / 60_000));
  if (source === "annas" && /DDoS-Guard challenge/i.test(reason)) {
    return (
      `unavailable — DDoS-Guard challenge; circuit open for ${minutes} min ` +
      "(set BIBLIO_ANNAS_API_KEY for member fast downloads)"
    );
  }
  return (
    `unavailable (circuit open after ${FAILURE_THRESHOLD} consecutive failures; ` +
    `retrying in ${minutes} min)`
  );
}

/** Run one complete provider operation through a source circuit. A failure
 *  after the caller cancelled (`signal` aborted) says nothing about the source. */
export async function withSourceCircuit<T>(
  source: SourceId,
  operation: () => Promise<T>,
  opts: { signal?: AbortSignal } = {}
): Promise<T> {
  const now = Date.now();
  const current = circuits.get(source);
  if (activeOpen(current, now)) {
    throw new SourceCircuitOpenError(source, openMessage(source, current?.reason ?? ""));
  }
  // Cooldown elapsed: forget the old trip and let traffic through again.
  if (current?.openedAt !== undefined) circuits.delete(source);

  try {
    const result = await operation();
    // A success clears ordinary failures, but never closes a circuit that was
    // opened while this request was in flight.
    if (!activeOpen(circuits.get(source), Date.now())) circuits.delete(source);
    return result;
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    // "Not on this source" proves the source answered. It is health, not failure.
    if (error instanceof ResourceNotFoundError) {
      if (!activeOpen(circuits.get(source), Date.now())) circuits.delete(source);
      throw error;
    }
    // Use the latest state: concurrent calls can fail while another operation
    // is in flight, and each completed failure must count once.
    const latest = circuits.get(source);
    const failures = (latest?.consecutiveFailures ?? 0) + 1;
    const tripped = failures >= FAILURE_THRESHOLD && !activeOpen(latest, Date.now());
    if (activeOpen(latest, Date.now())) {
      // Already open (late completion): keep the original trip.
    } else if (tripped) {
      circuits.set(source, {
        consecutiveFailures: failures,
        openedAt: Date.now(),
        reason: summarizeSourceFailure(source, error),
      });
    } else {
      circuits.set(source, { consecutiveFailures: failures });
    }
    throw error;
  }
}

/** Forget every source circuit. Tests use it so one scenario's failures do not leak into the next. */
export function resetSourceCircuits(): void {
  circuits.clear();
}

/** Human-readable reason for a source whose circuit is currently open. */
export function sourceCircuitMessage(source: SourceId): string | undefined {
  const state = circuits.get(source);
  return activeOpen(state, Date.now()) ? openMessage(source, state?.reason ?? "") : undefined;
}
