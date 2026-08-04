export function getTeamCode(teamId: string): string {
  return teamId.replace(/[^a-z0-9]/gi, '').slice(-4).padStart(4, '0').toUpperCase();
}
