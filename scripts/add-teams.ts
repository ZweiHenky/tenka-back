import { createDevelopmentPrismaClient } from '../src/utils/developmentDatabase';

const p = createDevelopmentPrismaClient();

const DIVISION_ID = 'cmr7l7jji0004hwvg052ex5vj';
const USER_ID = 'bEls5kJSCtEE9V79m5fAOmzLop21ajjQ';

const teamNames = [
  'Furia Azul',
  'Real Potosí',
  'Atlético Vega',
  'Deportivo Sol',
  'Club América del Sur',
  'Los Caimanes',
  'Estrella Roja FC',
  'Toros del Norte',
];

async function main() {
  for (const nombre of teamNames) {
    const equipo = await p.equipo.create({
      data: { nombre, nombreNormalizado: nombre.trim().toLowerCase(), userId: USER_ID },
    });
    await p.divisionEquipo.create({
      data: { divisionId: DIVISION_ID, equipoId: equipo.id },
    });
    console.log(`Creado y asignado: ${nombre} (${equipo.id})`);
  }
  console.log(`\n8 equipos agregados a Primera`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Team creation failed');
  process.exitCode = 1;
}).finally(() => p.$disconnect());
