import { parseConfiguredRanges, type ConfiguredTimeRange } from './timeRanges';

const DAY_MAP: Record<string, number> = {
  dom: 0, domingo: 0, domingos: 0, do: 0, d: 0,
  lun: 1, lunes: 1, lu: 1, l: 1,
  mar: 2, martes: 2, ma: 2, m: 2,
  mie: 3, miercoles: 3, mi: 3,
  jue: 4, jueves: 4, ju: 4, j: 4,
  vie: 5, viernes: 5, vi: 5, v: 5,
  sab: 6, sabado: 6, sabados: 6, sa: 6, s: 6,
};

const DAY_NAMES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

function stripDiacritics(value: string): string {
  // \p{M} = combining marks; keeps this file pure ASCII, unlike a literal U+0300-U+036F range.
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}


/**
 * Parses a `diasPartido` string into JS day numbers (0=Sunday). Tolerant of accents, `y`/`/`
 * separators and `lun a vie` / `L-V` ranges, which wrap around the week end.
 * This is the single day parser for the backend.
 */
export function parseConfiguredDays(value: string): Set<number> {
  const days = new Set<number>();
  for (const raw of stripDiacritics(value).replace(/\s+y\s+/g, ',').replace(/\//g, ',').split(/[,;]+/)) {
    const part = raw.trim();
    const range = part.match(/^(.+?)\s+(?:a|al)\s+(.+)$/) ?? part.match(/^(.+?)\s*-\s*(.+)$/);
    if (range) {
      const from = DAY_MAP[range[1].trim()];
      const to = DAY_MAP[range[2].trim()];
      if (from !== undefined && to !== undefined) {
        let day = from;
        while (true) {
          days.add(day);
          if (day === to) break;
          day = (day + 1) % 7;
        }
      }
      continue;
    }
    const day = DAY_MAP[part] ?? DAY_MAP[part.slice(0, 3)];
    if (day !== undefined) days.add(day);
  }
  return days;
}

export interface CourtScheduleRow {
  canchaId: string;
  diasPartido: string;
  horarioPartido: string;
}

export interface DivisionScheduleSource {
  multiplesCanchas: boolean;
  diasPartido: string | null;
  horarioPartido: string | null;
  canchaHorarios: CourtScheduleRow[];
}

export interface ResolvedCourtSchedule {
  days: Set<number>;
  ranges: ConfiguredTimeRange[];
}

/**
 * The days and time ranges a division plays, keyed by court id (`null` = the virtual single
 * court of a SINGLE-court league). A court missing from the map is one the division does not
 * play on. This is the only function allowed to decide that — never read the denormalized
 * `Division.diasPartido`/`horarioPartido` summary directly for validation.
 *
 * Three branches:
 *  1. Single-court league  → one `null` entry built from the division scalars.
 *  2. Multi-court WITH rows → one entry per configured *and active* court.
 *  3. Multi-court WITHOUT rows → legacy fallback: every active court inherits the scalars.
 *     Keeps pre-migration divisions working.
 */
export function resolveDivisionSchedule(
  source: DivisionScheduleSource,
  activeCourtIds: ReadonlySet<string>,
): Map<string | null, ResolvedCourtSchedule> {
  const resolved = new Map<string | null, ResolvedCourtSchedule>();
  const scalar = (): ResolvedCourtSchedule => ({
    days: parseConfiguredDays(source.diasPartido ?? ''),
    ranges: parseConfiguredRanges(source.horarioPartido ?? ''),
  });

  if (!source.multiplesCanchas) {
    resolved.set(null, scalar());
    return resolved;
  }

  const rows = source.canchaHorarios.filter((row) => activeCourtIds.has(row.canchaId));
  if (rows.length > 0) {
    for (const row of rows) {
      resolved.set(row.canchaId, {
        days: parseConfiguredDays(row.diasPartido),
        ranges: parseConfiguredRanges(row.horarioPartido),
      });
    }
    return resolved;
  }

  const legacy = scalar();
  for (const courtId of activeCourtIds) {
    resolved.set(courtId, legacy);
  }
  return resolved;
}

function mergeRanges(ranges: ConfiguredTimeRange[]): ConfiguredTimeRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: ConfiguredTimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Union of every court's configuration, used to keep the denormalized `Division` summary in
 * sync for the public listing and older clients. The result is a SUPERSET of what any single
 * court allows, so it must never be used to validate a slot.
 */
export function summarizeDivisionSchedule(rows: CourtScheduleRow[]): { diasPartido: string; horarioPartido: string } {
  const days = new Set<number>();
  const ranges: ConfiguredTimeRange[] = [];
  for (const row of rows) {
    for (const day of parseConfiguredDays(row.diasPartido)) days.add(day);
    ranges.push(...parseConfiguredRanges(row.horarioPartido));
  }
  return {
    diasPartido: [...days].sort((a, b) => a - b).map((day) => DAY_NAMES[day]).join(', '),
    horarioPartido: mergeRanges(ranges).map((r) => `${minutesToTime(r.start)} - ${minutesToTime(r.end)}`).join(' / '),
  };
}
