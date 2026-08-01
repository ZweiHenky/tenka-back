import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const user = await prisma.user.findFirstOrThrow({ where: { email: 'ronnhy7@gmail.com' } });
  const liga = await prisma.liga.findFirstOrThrow({
    where: { userId: user.id },
    include: { divisiones: true },
  });
  const division = liga.divisiones[0];
  console.log(`Liga: ${liga.nombre}, División: ${division.nombre} (${division.id})`);

  // Find the 5 teams we created (by name) + Mi Equipo
  const nombres = ['Dragones FC', 'Águilas Reales', 'Tiburones Rojos', 'Leones Negros', 'Rayos del Valle'];
  const equipos = await prisma.equipo.findMany({ where: { nombre: { in: nombres } } });
  console.log(`Equipos encontrados: ${equipos.length}`);

  // Remove them from seed-liga-1 division
  const del = await prisma.divisionEquipo.deleteMany({
    where: { equipoId: { in: equipos.map(e => e.id) } },
  });
  console.log(`Asignaciones eliminadas: ${del.count}`);

  // Assign all 5 to the user's division
  for (const eq of equipos) {
    await prisma.divisionEquipo.create({ data: { equipoId: eq.id, divisionId: division.id } });
    console.log(`  ${eq.nombre} asignado a ${division.nombre}`);
  }

  // Create 6th team
  const sexto = await prisma.equipo.create({
    data: { nombre: 'Fénix FC', nombreNormalizado: 'fénix fc', userId: user.id },
  });
  await prisma.divisionEquipo.create({ data: { equipoId: sexto.id, divisionId: division.id } });
  console.log(`  ${sexto.nombre} (nuevo) asignado a ${division.nombre}`);

  // Also assign "Mi Equipo" if it exists and belongs to this user
  const miEquipo = await prisma.equipo.findFirst({ where: { nombre: 'Mi Equipo', userId: user.id } });
  if (miEquipo) {
    const exists = await prisma.divisionEquipo.findFirst({
      where: { equipoId: miEquipo.id, divisionId: division.id },
    });
    if (!exists) {
      await prisma.divisionEquipo.create({ data: { equipoId: miEquipo.id, divisionId: division.id } });
      console.log(`  ${miEquipo.nombre} asignado a ${division.nombre}`);
    }
  }

  console.log('\n¡Listo!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
