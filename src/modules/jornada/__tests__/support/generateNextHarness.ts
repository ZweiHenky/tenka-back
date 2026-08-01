import { vi } from 'vitest';
import { jornadaService as rawJornadaService } from '../../service';

vi.mock('../../../../config/database', () => ({
  prisma: {
    division: { findUnique: vi.fn() },
    divisionEquipo: { findMany: vi.fn() },
    partido: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    jornada: { findUnique: vi.fn(), create: vi.fn() },
    rondaPlayoff: { findMany: vi.fn(), findFirst: vi.fn() },
    ligaCancha: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../repository', () => ({
  jornadaRepository: {
    findByDivision: vi.fn(),
    findGenerationHistory: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../partido/repository', () => ({
  partidoRepository: { create: vi.fn(), findById: vi.fn(), update: vi.fn() },
}));

vi.mock('../../../tabla-posicion/service', () => ({
  tablaPosicionService: { recalcular: vi.fn() },
}));

vi.mock('../../../notification/service', () => ({
  notificationService: { notifyJornadaGenerated: vi.fn() },
}));

vi.mock('../../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { prisma as importedPrisma } from '../../../../config/database';
import { jornadaRepository as importedJornadaRepository } from '../../repository';
import { partidoRepository as importedPartidoRepository } from '../../../partido/repository';
import { notificationService as importedNotificationService } from '../../../notification/service';
import { logger as importedLogger } from '../../../../config/logger';
import type { AuthenticatedUser } from '../../../../types/auth';

export const prisma = importedPrisma;
export const jornadaRepository = importedJornadaRepository;
export const partidoRepository = importedPartidoRepository;
export const notificationService = importedNotificationService;
export const logger = importedLogger;

export const divisionId = 'div-test-1';
export const owner: AuthenticatedUser = { id: 'user-1', email: 'owner@test.com', rol: 'LIGA' };

function generateNext(_divisionId: string, slots?: Parameters<typeof rawJornadaService.generateNext>[2]) {
  return rawJornadaService.generateNext(divisionId, owner, slots);
}

export const jornadaService = { ...rawJornadaService, generateNext };

export const TEAMS = [
  { id: 't1', nombre: 'Águilas' },
  { id: 't2', nombre: 'Dragones' },
  { id: 't3', nombre: 'Genix' },
  { id: 't4', nombre: 'Mi Equipo' },
  { id: 't5', nombre: 'Leones' },
  { id: 't6', nombre: 'Tiburones' },
  { id: 't7', nombre: 'Panteras' },
];

export function mockDivision(opts?: { maxEquipos?: number; diasPartido?: string | null }) {
  (prisma.division.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (query) => {
    if (query.select?.liga && !query.select?.diasPartido) return { liga: { userId: owner.id } };
    return {
      maxEquipos: opts?.maxEquipos ?? 7,
      diasPartido: opts?.diasPartido ?? null,
      duracionPartido: null,
      ligaId: 'liga-1',
      liga: { userId: owner.id },
    };
  });
}

export function mockTeams(ids?: string[]) {
  const selected = ids ? TEAMS.filter((t) => ids.includes(t.id)) : TEAMS;
  (prisma.divisionEquipo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    selected.map((t) => ({ equipo: { id: t.id, nombre: t.nombre } })),
  );
}

export function mockNoPreviousJornadas() {
  (jornadaRepository.findByDivision as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
}

export function mockJornadaCreated(numero: number = 1) {
  const jornada = { id: 'j-new-1', numero, divisionId };
  (jornadaRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue(jornada);
  return jornada;
}

export function mockPartidosCreatedReturn(count: number) {
  (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    Array.from({ length: count }, () => ({ fecha: new Date('2026-07-02T18:00:00') })),
  );
}

export function expectMatch(calls: unknown[][], localId: string, visitaId: string, tipo?: string) {
  return calls.some(([args]: any[]) =>
    args.equipoLocalId === localId
    && args.equipoVisitanteId === visitaId
    && (tipo === undefined || args.tipoPartido === tipo)
  );
}

export function resetGenerateNextHarness() {
  vi.resetAllMocks();
  (prisma.rondaPlayoff.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.rondaPlayoff.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const rows = await (prisma.rondaPlayoff.findMany as any)();
    return rows[0] ?? null;
  });
  (jornadaRepository.findGenerationHistory as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const result = await (jornadaRepository.findByDivision as any)();
    return result?.rows ?? [];
  });
  (prisma.partido.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (query) => {
    if (!query?.where?.id?.in) return [];
    const rows = await Promise.all(query.where.id.in.map((id: string) => partidoRepository.findById(id)));
    return rows.filter(Boolean);
  });
  (prisma.partido.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ where, data }) => partidoRepository.update(where.id, data));
  (prisma.partido.createMany as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }) => {
    for (const partido of data) await partidoRepository.create(partido);
    return { count: data.length };
  });
  (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) => callback({
    jornada: {
      create: vi.fn(async ({ data }) => jornadaRepository.create(data)),
    },
    partido: {
      update: prisma.partido.update,
      createMany: prisma.partido.createMany,
    },
  }));
  (notificationService.notifyJornadaGenerated as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}
