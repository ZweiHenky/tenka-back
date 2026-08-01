import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const ligas = await prisma.liga.findMany({ include: { user: true, divisiones: true } });
  console.log('Ligas:');
  for (const l of ligas) {
    console.log(`  ${l.nombre} (${l.id})`);
    console.log(`    usuario: ${l.user.name} (${l.user.email})`);
    console.log(`    divisiones: ${l.divisiones.map(d => d.nombre).join(', ')}`);
  }
  const equipos = await prisma.equipo.findMany({ include: { user: true, divisiones: { include: { division: { include: { liga: true } } } } } });
  console.log('\nEquipos:');
  for (const e of equipos) {
    const divs = e.divisiones.map(de => `${de.division.nombre} (${de.division.liga.nombre})`).join(', ') || 'sin división';
    console.log(`  ${e.nombre} — ${divs}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
