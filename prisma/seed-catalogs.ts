import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const prisma = createDevelopmentPrismaClient();

async function main() {
  await prisma.categoria.createMany({
    data: [
      { nombre: 'LIBRE' },
      { nombre: 'VARONIL' },
      { nombre: 'FEMENIL' },
      { nombre: 'INFANTIL' },
      { nombre: 'INFANTIL FEMENIL' },
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
      { nombre: 'Liga' },
      { nombre: 'Copa' },
      { nombre: 'Liga y Eliminatorias' },
      { nombre: 'Grupos y Eliminatorias' },
    ],
    skipDuplicates: true,
  });

  console.log('Catálogos creados exitosamente.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Catalog seed failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
