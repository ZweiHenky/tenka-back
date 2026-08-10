import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const prisma = createDevelopmentPrismaClient();

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { email: 'demo@tenka.app' } });
  console.log(`Usuario: ${user.name} (${user.id})`);

  const ligas = await prisma.liga.findMany({
    where: { userId: user.id },
    include: { divisiones: { take: 1 } },
  });
  console.log(`Ligas encontradas: ${ligas.length}`);
  ligas.forEach(l => console.log(`  - ${l.nombre} (${l.id}), divisiones: ${l.divisiones.length}`));

  if (!ligas.length || !ligas[0].divisiones.length) {
    console.log('No hay ligas o divisiones disponibles');
    return;
  }

  const liga = ligas[0];
  const division = liga.divisiones[0];
  console.log(`Usando liga: ${liga.nombre}, división: ${division.nombre} (${division.id})`);

  const nombres = ['Dragones FC', 'Águilas Reales', 'Tiburones Rojos', 'Leones Negros', 'Rayos del Valle'];

  for (const nombre of nombres) {
    const equipo = await prisma.equipo.create({
      data: { nombre, nombreNormalizado: nombre.trim().toLowerCase(), userId: user.id },
    });
    console.log(`Equipo creado: ${equipo.nombre} (${equipo.id})`);

    await prisma.divisionEquipo.create({
      data: { equipoId: equipo.id, divisionId: division.id },
    });
    console.log(`  -> asignado a división ${division.nombre}`);
  }

  console.log('\n¡5 equipos creados y asignados exitosamente!');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Team seed failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
