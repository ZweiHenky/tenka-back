"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visibleDivisionWhere = visibleDivisionWhere;
exports.assertVisibleDivision = assertVisibleDivision;
const database_1 = require("../config/database");
const errors_1 = require("./errors");
function visibleDivisionWhere(actor) {
    if (actor?.rol === 'ADMINISTRADOR')
        return {};
    const published = { estadoLiga: { nombre: { not: 'Borrador' } } };
    return actor ? { OR: [published, { liga: { userId: actor.id } }] } : published;
}
async function assertVisibleDivision(divisionId, actor) {
    const division = await database_1.prisma.division.findFirst({
        where: { id: divisionId, ...visibleDivisionWhere(actor) },
        select: { id: true },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
}
//# sourceMappingURL=divisionVisibility.js.map