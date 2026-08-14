import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const prisma = createDevelopmentPrismaClient();

async function main() {
  // ── Catalog ──────────────────────────────────────────────────────

  await prisma.categoria.createMany({
    data: [
      { nombre: 'LIBRE' },
      { nombre: 'VARONIL' },
      { nombre: 'FEMENIL' },
      { nombre: 'INFANTIL' },
      { nombre: 'INFANTIL FEMENIL' },
      { nombre: 'JUVENIL' },
      { nombre: 'SUB-15' },
      { nombre: 'SUB-15 FEMENIL' },
      { nombre: 'SUB-18' },
      { nombre: 'SUB-18 FEMENIL' },
      { nombre: 'SUB-20' },
      { nombre: 'SUB-20 FEMENIL' },
      { nombre: 'VETERANOS' },
      { nombre: 'VETERANOS FEMENIL' },
      { nombre: 'MIXTO' },
    ],
    skipDuplicates: true,
  });

  await prisma.tipo.createMany({
    data: [
      { nombre: 'FUTBOL 7' },
      { nombre: 'RAPIDO' },
      { nombre: 'FUTBOL 9' },
      { nombre: 'SOCCER' },
      { nombre: 'SALA' },
      { nombre: 'FUTBOL 5' },
    ],
    skipDuplicates: true,
  });

  await prisma.estadoLiga.createMany({
    data: [
      { nombre: 'Borrador' },
      { nombre: 'Abierta' },
      { nombre: 'En Curso' },
      { nombre: 'Finalizada' },
      { nombre: 'Cancelada' },
    ],
    skipDuplicates: true,
  });

  await prisma.tipoCompetencia.createMany({
    data: [
      { nombre: 'Liga y Eliminatorias' },
    ],
    skipDuplicates: true,
  });

  // ── Lookup handles ───────────────────────────────────────────────

  const libre = await prisma.categoria.findFirstOrThrow({ where: { nombre: 'LIBRE' } });
  const varonil = await prisma.categoria.findFirstOrThrow({ where: { nombre: 'VARONIL' } });
  const femenil = await prisma.categoria.findFirstOrThrow({ where: { nombre: 'FEMENIL' } });
  const mixto = await prisma.categoria.findFirstOrThrow({ where: { nombre: 'MIXTO' } });

  const fb7 = await prisma.tipo.findFirstOrThrow({ where: { nombre: 'FUTBOL 7' } });
  const soccer = await prisma.tipo.findFirstOrThrow({ where: { nombre: 'SOCCER' } });
  const sala = await prisma.tipo.findFirstOrThrow({ where: { nombre: 'SALA' } });

  const borrador = await prisma.estadoLiga.findFirstOrThrow({ where: { nombre: 'Borrador' } });
  const abierta = await prisma.estadoLiga.findFirstOrThrow({ where: { nombre: 'Abierta' } });
  const enCurso = await prisma.estadoLiga.findFirstOrThrow({ where: { nombre: 'En Curso' } });
  const finalizada = await prisma.estadoLiga.findFirstOrThrow({ where: { nombre: 'Finalizada' } });

  const ligaElim = await prisma.tipoCompetencia.findFirstOrThrow({ where: { nombre: 'Liga y Eliminatorias' } });

  // ── Demo user ────────────────────────────────────────────────────

  const user = await prisma.user.upsert({
    where: { email: 'demo@tenka.app' },
    update: {},
    create: {
      email: 'demo@tenka.app',
      emailVerified: true,
      name: 'Demo Capitán',
      rol: 'CAPITAN',
    },
  });

  // ── Ubicaciones ──────────────────────────────────────────────────

  const cdmx = await prisma.ubicacion.create({
    data: {
      lat: 19.4326,
      lng: -99.1332,
      nombreCompleto: 'Ciudad de México, CDMX, México',
      estado: 'Ciudad de México',
      municipio: 'Cuauhtémoc',
    },
  });

  const monterrey = await prisma.ubicacion.create({
    data: {
      lat: 25.6866,
      lng: -100.3161,
      nombreCompleto: 'Monterrey, Nuevo León, México',
      estado: 'Nuevo León',
      municipio: 'Monterrey',
    },
  });

  // ── Ligas ────────────────────────────────────────────────────────

  const liga1 = await prisma.liga.upsert({
    where: { id: 'seed-liga-1' },
    update: {},
    create: {
      id: 'seed-liga-1',
      nombre: 'Liga Nocturna CDMX',
      nombreNormalizado: 'liga nocturna cdmx',
      descripcion: 'Liga de fut 7 nocturna en la Ciudad de México. Partidos los viernes por la noche.',
      ubicacionId: cdmx.id,
      userId: user.id,
    },
  });

  const liga2 = await prisma.liga.upsert({
    where: { id: 'seed-liga-2' },
    update: {},
    create: {
      id: 'seed-liga-2',
      nombre: 'Liga Premier Monterrey',
      nombreNormalizado: 'liga premier monterrey',
      descripcion: 'Competencia de futbol soccer en Monterrey con las mejores categorías.',
      ubicacionId: monterrey.id,
      userId: user.id,
    },
  });

  // ── Divisiones ───────────────────────────────────────────────────

  // Liga Nocturna CDMX — 2 divisiones
  await prisma.division.upsert({
    where: { id: 'seed-div-1' },
    update: {},
    create: {
      id: 'seed-div-1',
      nombre: 'Libre Varomil',
      maxEquipos: 10,
      arbitraje: 250,
      diasPartido: 'Viernes',
      horarioPartido: '21:00 - 23:00',
      ligaId: liga1.id,
      estadoLigaId: abierta.id,
      categoriaId: libre.id,
      tipoId: fb7.id,
      tipoCompetenciaId: ligaElim.id,
    },
  });

  await prisma.division.upsert({
    where: { id: 'seed-div-2' },
    update: {},
    create: {
      id: 'seed-div-2',
      nombre: 'Femenil',
      maxEquipos: 8,
      arbitraje: 200,
      diasPartido: 'Sábados',
      horarioPartido: '18:00 - 20:00',
      ligaId: liga1.id,
      estadoLigaId: borrador.id,
      categoriaId: femenil.id,
      tipoId: fb7.id,
      tipoCompetenciaId: ligaElim.id,
    },
  });

  // Liga Premier Monterrey — 2 divisiones
  await prisma.division.upsert({
    where: { id: 'seed-div-3' },
    update: {},
    create: {
      id: 'seed-div-3',
      nombre: 'Primera Fuerza',
      maxEquipos: 12,
      arbitraje: 350,
      diasPartido: 'Domingos',
      horarioPartido: '09:00 - 13:00',
      ligaId: liga2.id,
      estadoLigaId: enCurso.id,
      categoriaId: varonil.id,
      tipoId: soccer.id,
      tipoCompetenciaId: ligaElim.id,
    },
  });

  await prisma.division.upsert({
    where: { id: 'seed-div-4' },
    update: {},
    create: {
      id: 'seed-div-4',
      nombre: 'Sala Mixto',
      maxEquipos: 6,
      arbitraje: 150,
      diasPartido: 'Martes y Jueves',
      horarioPartido: '20:00 - 22:00',
      ligaId: liga2.id,
      estadoLigaId: finalizada.id,
      categoriaId: mixto.id,
      tipoId: sala.id,
      tipoCompetenciaId: ligaElim.id,
    },
  });

  console.log('Seed completado — ligas y divisiones de ejemplo creadas.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
