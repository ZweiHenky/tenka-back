"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const developmentDatabase_1 = require("../utils/developmentDatabase");
const prisma = (0, developmentDatabase_1.createDevelopmentPrismaClient)();
async function main() {
    const userId = 'bEls5kJSCtEE9V79m5fAOmzLop21ajjQ';
    const names = ['Dragones FC', 'Águilas Azules', 'Tigres Rojos', 'Panteras Negras', 'Leones Dorados', 'Halcones Blancos'];
    const created = [];
    for (const nombre of names) {
        const eq = await prisma.equipo.create({ data: { nombre, nombreNormalizado: nombre.trim().toLowerCase(), userId } });
        created.push(eq);
        console.log('Creado:', eq.id, eq.nombre);
    }
    console.log('Equipos creados:', created.length);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Team seed failed');
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
//# sourceMappingURL=seed-teams.js.map