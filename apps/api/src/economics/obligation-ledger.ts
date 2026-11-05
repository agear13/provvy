import { obligationSnapshotEqual } from './rules-engine';
import {
  D3_OBLIGATION_KEY,
  RETRY_IDEMPOTENCY_KEY,
  type EngineResult,
  type HoldDraft,
  type ObligationDraft,
} from './types';

export type PersistStatus =
  | 'CREATED'
  | 'IDEMPOTENT'
  | 'REJECTED_DUPLICATE'
  | 'REJECTED_CONFIGURATION';

export interface PersistResult {
  status: PersistStatus;
  guard?: 'D3' | 'RETRY' | 'EVENT_DECISION';
  obligations: ObligationDraft[];
  hold?: HoldDraft;
  detail?: string;
}

/**
 * In-memory stand-in for the database uniqueness constraints.
 * The mutex matches the transaction advisory lock: concurrent callers
 * cannot both insert. Keys are exactly D3 and the legacy retry key.
 */
export class ObligationLedger {
  private obligations: ObligationDraft[] = [];
  private holds: HoldDraft[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  listObligations(): ObligationDraft[] {
    return this.obligations.map((row) => structuredClone(row));
  }

  listHolds(): HoldDraft[] {
    return this.holds.map((row) => structuredClone(row));
  }

  async persist(result: EngineResult): Promise<PersistResult> {
    const run = this.tail.then(() => this.persistLocked(result));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private persistLocked(result: EngineResult): PersistResult {
    if (result.kind === 'rejected') {
      return {
        status: 'REJECTED_CONFIGURATION',
        obligations: [],
        detail: result.detail,
      };
    }
    if (result.kind === 'held') {
      return this.persistHold(result);
    }
    return this.persistObligations(result.obligations);
  }

  private persistHold(hold: HoldDraft): PersistResult {
    const existingObligations = this.obligations.filter(
      (row) => row.sourceEventId === hold.sourceEventId,
    );
    if (existingObligations.length > 0) {
      return {
        status: 'REJECTED_DUPLICATE',
        guard: 'D3',
        obligations: existingObligations.map((row) => structuredClone(row)),
        detail: 'event already has obligations',
      };
    }
    const existing = this.holds.find(
      (row) => row.sourceEventId === hold.sourceEventId,
    );
    if (!existing) {
      const stored = structuredClone(hold);
      this.holds.push(stored);
      return {
        status: 'CREATED',
        obligations: [],
        hold: structuredClone(stored),
      };
    }
    if (
      existing.reason === hold.reason &&
      existing.agreementVersionId === hold.agreementVersionId &&
      existing.financialEffect === 'NONE'
    ) {
      return {
        status: 'IDEMPOTENT',
        obligations: [],
        hold: structuredClone(existing),
      };
    }
    return {
      status: 'REJECTED_DUPLICATE',
      guard: 'EVENT_DECISION',
      obligations: [],
      hold: structuredClone(existing),
      detail: 'event decision already recorded',
    };
  }

  private persistObligations(drafts: ObligationDraft[]): PersistResult {
    const eventId = drafts[0]?.sourceEventId;
    if (!eventId) {
      return { status: 'CREATED', obligations: [] };
    }
    const held = this.holds.find((row) => row.sourceEventId === eventId);
    if (held) {
      return {
        status: 'REJECTED_DUPLICATE',
        guard: 'EVENT_DECISION',
        obligations: [],
        hold: structuredClone(held),
        detail: 'event already held',
      };
    }

    const internal = classifyBatch([], drafts);
    if (internal.reject) {
      return {
        status: 'REJECTED_DUPLICATE',
        guard: internal.reject,
        obligations: [],
        detail: 'duplicate inside batch',
      };
    }

    const existing = this.obligations.filter(
      (row) => row.sourceEventId === eventId,
    );
    if (existing.length === 0) {
      const stored = drafts.map((row) => structuredClone(row));
      this.obligations.push(...stored);
      return {
        status: 'CREATED',
        obligations: stored.map((row) => structuredClone(row)),
      };
    }

    const verdict = classifyBatch(existing, drafts);
    if (verdict.identical) {
      return {
        status: 'IDEMPOTENT',
        obligations: existing.map((row) => structuredClone(row)),
      };
    }
    return {
      status: 'REJECTED_DUPLICATE',
      guard: verdict.reject ?? 'D3',
      obligations: existing.map((row) => structuredClone(row)),
      detail: 'obligation guard rejected a second financial row',
    };
  }
}

export function d3Key(row: ObligationDraft): string {
  return D3_OBLIGATION_KEY.map((field) => row[field]).join('|');
}

export function retryKey(row: ObligationDraft): string {
  return RETRY_IDEMPOTENCY_KEY.map((field) => row[field]).join('|');
}

export function classifyBatch(
  existing: readonly ObligationDraft[],
  drafts: readonly ObligationDraft[],
): { identical: boolean; reject?: 'D3' | 'RETRY' | 'EVENT_DECISION' } {
  const seenD3 = new Set<string>();
  const seenRetry = new Set<string>();
  for (const draft of drafts) {
    const d3 = d3Key(draft);
    const retry = retryKey(draft);
    if (seenD3.has(d3)) return { identical: false, reject: 'D3' };
    if (seenRetry.has(retry)) return { identical: false, reject: 'RETRY' };
    seenD3.add(d3);
    seenRetry.add(retry);
  }

  if (existing.length === 0) return { identical: false };

  let d3Conflict = false;
  let retryConflict = false;
  for (const draft of drafts) {
    const d3Hit = existing.find((row) => d3Key(row) === d3Key(draft));
    const retryHit = existing.find((row) => retryKey(row) === retryKey(draft));
    if (d3Hit && !obligationSnapshotEqual(d3Hit, draft)) d3Conflict = true;
    if (retryHit && !obligationSnapshotEqual(retryHit, draft))
      retryConflict = true;
  }

  const sameSet =
    existing.length === drafts.length &&
    drafts.every((draft) =>
      existing.some((row) => obligationSnapshotEqual(row, draft)),
    );
  if (sameSet) return { identical: true };
  if (d3Conflict) return { identical: false, reject: 'D3' };
  if (retryConflict) return { identical: false, reject: 'RETRY' };
  return { identical: false, reject: 'EVENT_DECISION' };
}
