"use strict";
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
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
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=seed-teams.js.map