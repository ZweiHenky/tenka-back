let acceptingTraffic = true;

export function isReadyForTraffic(): boolean {
  return acceptingTraffic;
}

export function markNotReady(): void {
  acceptingTraffic = false;
}

export function resetReadinessForTests(): void {
  acceptingTraffic = true;
}
