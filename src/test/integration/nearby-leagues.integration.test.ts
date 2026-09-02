import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/database';
import { ligaRepository } from '../../modules/liga/repository';

const prefix = 'it-nearby-';
const ids = {
  user: `${prefix}user`,
  category: `${prefix}category`,
  otherCategory: `${prefix}other-category`,
  type: `${prefix}type`,
  otherType: `${prefix}other-type`,
  state: `${prefix}state`,
  draft: `${prefix}draft`,
  competition: `${prefix}competition`,
  near: `${prefix}near`,
  middle: `${prefix}middle`,
  far: `${prefix}far`,
  hidden: `${prefix}hidden`,
} as const;

async function cleanup(): Promise<void> {
  await prisma.liga.deleteMany({ where: { id: { startsWith: prefix } } });
  await Promise.all([
    prisma.ubicacion.deleteMany({ where: { id: { startsWith: prefix } } }),
    prisma.categoria.deleteMany({ where: { id: { startsWith: prefix } } }),
    prisma.tipo.deleteMany({ where: { id: { startsWith: prefix } } }),
    prisma.estadoLiga.deleteMany({ where: { id: { startsWith: prefix } } }),
    prisma.tipoCompetencia.deleteMany({ where: { id: { startsWith: prefix } } }),
    prisma.user.deleteMany({ where: { id: { startsWith: prefix } } }),
  ]);
}

async function createLeagueFixture(fixture: {
  id: string
  name: string
  lat: number
  lng: number
  categoryId: string
  stateId: string
  createdAt?: Date
}): Promise<void> {
  const locationId = `${fixture.id}-location`;
  await prisma.ubicacion.create({
    data: { id: locationId, lat: fixture.lat, lng: fixture.lng, nombreCompleto: fixture.name, estado: 'Test', municipio: 'Test', timeZone: 'America/Mexico_City' },
  });
  await prisma.liga.create({
    data: {
      id: fixture.id,
      nombre: fixture.name,
      nombreNormalizado: fixture.name.toLowerCase(),
      descripcion: 'Nearby integration fixture',
      createdAt: fixture.createdAt,
      ubicacionId: locationId,
      userId: ids.user,
      divisiones: {
        create: {
          id: `${fixture.id}-division`,
          nombre: 'Primera',
          maxEquipos: 8,
          estadoLigaId: fixture.stateId,
          categoriaId: fixture.categoryId,
          tipoId: ids.type,
          tipoCompetenciaId: ids.competition,
        },
      },
    },
  });
}

beforeEach(async () => {
  await cleanup();
  await prisma.user.create({ data: { id: ids.user, email: `${prefix}owner@example.test`, name: 'Nearby Owner', rol: 'LIGA' } });
  await Promise.all([
    prisma.categoria.create({ data: { id: ids.category, nombre: 'Nearby Category' } }),
    prisma.categoria.create({ data: { id: ids.otherCategory, nombre: 'Other Category' } }),
    prisma.tipo.create({ data: { id: ids.type, nombre: 'Nearby Type' } }),
    prisma.tipo.create({ data: { id: ids.otherType, nombre: 'Other Type' } }),
    prisma.estadoLiga.create({ data: { id: ids.state, nombre: 'En Curso', codigo: 'EN_CURSO' } }),
    prisma.estadoLiga.create({ data: { id: ids.draft, nombre: 'Borrador', codigo: 'BORRADOR' } }),
    prisma.tipoCompetencia.create({ data: { id: ids.competition, nombre: 'Liga', codigo: 'LIGA_Y_ELIMINATORIAS' } }),
  ]);

  const fixtures = [
    { id: ids.near, name: 'Liga Centro', lat: 19.4326, lng: -99.1332, categoryId: ids.category, stateId: ids.state },
    { id: ids.middle, name: 'Liga Norte', lat: 19.5, lng: -99.13, categoryId: ids.category, stateId: ids.state },
    { id: ids.far, name: 'Liga Lejana Especial', lat: 25.6866, lng: -100.3161, categoryId: ids.otherCategory, stateId: ids.state },
    { id: ids.hidden, name: 'Liga Oculta', lat: 19.4327, lng: -99.1332, categoryId: ids.category, stateId: ids.draft },
  ];
  for (const fixture of fixtures) {
    await createLeagueFixture(fixture);
  }
});

afterEach(cleanup);

describe('nearby leagues query', () => {
  it('orders by distance, excludes drafts and keeps pagination totals', async () => {
    const first = await ligaRepository.findAllPaginated({
      page: 1, limit: 2, latitude: 19.433, longitude: -99.133,
    });
    const second = await ligaRepository.findAllPaginated({
      page: 2, limit: 2, latitude: 19.433, longitude: -99.133,
    });

    expect(first.rows.map((league) => league.id)).toEqual([ids.near, ids.middle]);
    expect(second.rows.map((league) => league.id)).toEqual([ids.far]);
    expect(first.total).toBe(3);
    expect(first.rows[0].distanceKm).toBeLessThan(0.1);
    expect(first.rows[1].distanceKm).toBeGreaterThan(7);
    expect(first.rows[0].ubicacion?.nombreCompleto).toBe('Liga Centro');
  });

  it('keeps search global and applies division filters inside visibility', async () => {
    const search = await ligaRepository.findAllPaginated({
      page: 1, limit: 20, search: 'Lejana', latitude: 19.433, longitude: -99.133,
    });
    const category = await ligaRepository.findAllPaginated({
      page: 1, limit: 20, categoriaId: ids.category, latitude: 19.433, longitude: -99.133,
    });

    expect(search.rows.map((league) => league.id)).toEqual([ids.far]);
    expect(category.rows.map((league) => league.id)).toEqual([ids.near, ids.middle]);
  });

  it('uses id as stable tiebreaker across pages with equal distance and date', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await createLeagueFixture({ id: `${prefix}tie-b`, name: 'Liga Empate B', lat: 19.4326, lng: -99.1332, categoryId: ids.category, stateId: ids.state, createdAt });
    await createLeagueFixture({ id: `${prefix}tie-a`, name: 'Liga Empate A', lat: 19.4326, lng: -99.1332, categoryId: ids.category, stateId: ids.state, createdAt });

    const first = await ligaRepository.findAllPaginated({ page: 1, limit: 1, search: 'Empate', latitude: 19.433, longitude: -99.133 });
    const second = await ligaRepository.findAllPaginated({ page: 2, limit: 1, search: 'Empate', latitude: 19.433, longitude: -99.133 });

    expect([...first.rows, ...second.rows].map((league) => league.id)).toEqual([`${prefix}tie-a`, `${prefix}tie-b`]);
  });

  it('does not combine category and type from different divisions', async () => {
    await prisma.division.create({
      data: {
        id: `${ids.near}-other-division`,
        nombre: 'Segunda',
        maxEquipos: 8,
        ligaId: ids.near,
        estadoLigaId: ids.state,
        categoriaId: ids.otherCategory,
        tipoId: ids.otherType,
        tipoCompetenciaId: ids.competition,
      },
    });

    const result = await ligaRepository.findAllPaginated({
      page: 1,
      limit: 20,
      categoriaId: ids.category,
      tipoId: ids.otherType,
      latitude: 19.433,
      longitude: -99.133,
    });

    expect(result.rows).toEqual([]);
  });
});
