interface CapacityGrantAt {
  id: string;
  effectiveAt: Date;
  sequence: number;
  newCapacity: number;
}

export function effectiveCapacityAt(
  capacityAtStart: number,
  grants: CapacityGrantAt[],
  at: Date,
): number {
  const latest = grants
    .filter(({ effectiveAt }) => effectiveAt <= at)
    .sort((left, right) => right.effectiveAt.getTime() - left.effectiveAt.getTime()
      || right.sequence - left.sequence
      || right.id.localeCompare(left.id))[0];
  return latest?.newCapacity ?? capacityAtStart;
}
