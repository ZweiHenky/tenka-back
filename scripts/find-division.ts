import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
async function main() {
  const links = await p.divisionEquipo.findMany({ where: { divisionId: 'cmr7l7jji0004hwvg052ex5vj' }, include: { equipo: true } });
  console.log("Equipos en Primera:", JSON.stringify(links.map(l => ({ id: l.equipoId, nombre: l.equipo.nombre }))));
  console.log("Total:", links.length);
  await p.$disconnect();
}
main();
