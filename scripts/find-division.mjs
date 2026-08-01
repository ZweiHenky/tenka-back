import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const divisions = await p.division.findMany({ where: { nombre: { contains: 'primera', mode: 'insensitive' } }, include: { liga: true } });
console.log(JSON.stringify(divisions, null, 2));
const teams = await p.equipo.findMany({ take: 20 });
console.log("Equipos existentes:", JSON.stringify(teams.map(t => ({ id: t.id, nombre: t.nombre }))));
await p.$disconnect();
