import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const p = createDevelopmentPrismaClient();
async function main() {
  const links = await p.divisionEquipo.findMany({ where: { divisionId: 'cmr7l7jji0004hwvg052ex5vj' }, include: { equipo: true } });
  console.log("Equipos en Primera:", JSON.stringify(links.map(l => ({ id: l.equipoId, nombre: l.equipo.nombre }))));
  console.log("Total:", links.length);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Division lookup failed');
  process.exitCode = 1;
}).finally(() => p.$disconnect());
