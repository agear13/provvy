/** Integer atomic minor units. Half-even is the addendum's proposed mode (§24 / §11.2 OPEN). */

const BPS_SCALE = 10000n;

export function divHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('denominator must be positive');
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const twice = remainder * 2n;
  let rounded = quotient;
  if (twice > denominator) {
    rounded = quotient + 1n;
  } else if (twice === denominator && quotient % 2n === 1n) {
    rounded = quotient + 1n;
  }
  return negative ? -rounded : rounded;
}

/** `amount × bps / 10000`, rounded half-even once. Rejects non-integers and out-of-range bps. */
export function mulBpsHalfEven(amount: bigint, bps: bigint): bigint {
  if (amount < 0n) {
    throw new Error('atomic amount must be non-negative');
  }
  if (bps < 0n || bps > BPS_SCALE) {
    throw new Error('bps must be an integer from 0 to 10000');
  }
  return divHalfEven(amount * bps, BPS_SCALE);
}

export interface PoolShare {
  memberId: string;
  bps: bigint;
}

export interface PoolAllocation {
  memberId: string;
  amountAtomic: bigint;
}

/**
 * Split-pool method from Addendum A §24 (proposed / OPEN): floor each exact
 * share, then give leftover units to the largest fractional remainder.
 * Ties break by member id ascending. Undistributed base is residual that
 * stays with the org — this function does not create an obligation for it.
 */
export function allocateLargestRemainder(
  pool: bigint,
  shares: readonly PoolShare[],
): { allocations: PoolAllocation[]; residualAtomic: bigint } {
  if (pool < 0n) {
    throw new Error('pool must be non-negative');
  }
  if (shares.length === 0) {
    return { allocations: [], residualAtomic: pool };
  }

  const exacts = shares.map((share, index) => {
    if (share.bps < 0n || share.bps > BPS_SCALE) {
      throw new Error('bps must be an integer from 0 to 10000');
    }
    const product = pool * share.bps;
    return {
      index,
      memberId: share.memberId,
      floor: product / BPS_SCALE,
      remainder: product % BPS_SCALE,
    };
  });

  const exactSum = shares.reduce((sum, share) => sum + pool * share.bps, 0n);
  const totalDue = divHalfEven(exactSum, BPS_SCALE);
  const floored = exacts.reduce((sum, row) => sum + row.floor, 0n);
  const units = totalDue - floored;
  if (units < 0n || units > BigInt(exacts.length)) {
    throw new Error('largest-remainder leftover is outside the split');
  }

  const order = [...exacts].sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1;
    }
    if (a.memberId !== b.memberId) {
      return a.memberId < b.memberId ? -1 : 1;
    }
    return a.index - b.index;
  });

  const bonus = new Map<number, bigint>();
  for (let i = 0; i < Number(units); i += 1) {
    const winner = order[i];
    bonus.set(winner.index, (bonus.get(winner.index) ?? 0n) + 1n);
  }

  const allocations = exacts.map((row) => ({
    memberId: row.memberId,
    amountAtomic: row.floor + (bonus.get(row.index) ?? 0n),
  }));
  const paid = allocations.reduce((sum, row) => sum + row.amountAtomic, 0n);
  return { allocations, residualAtomic: pool - paid };
}
