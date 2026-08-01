"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionEquipoService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const database_1 = require("../../config/database");
const authorization_1 = require("../../utils/authorization");
async function assertDivisionOwner(divisionId, actor) {
    const division = await database_1.prisma.division.findFirst({
        where: (0, authorization_1.isAdmin)(actor) ? { id: divisionId } : { id: divisionId, liga: { userId: actor.id } },
        select: { id: true },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
}
exports.divisionEquipoService = {
    async findByDivision(divisionId, actor) {
        const equipos = await repository_1.divisionEquipoRepository.findByDivision(divisionId, actor);
        if (!equipos)
            throw new errors_1.NotFoundError('División');
        return equipos;
    },
    async findByEquipo(equipoId, actor) {
        return repository_1.divisionEquipoRepository.findByEquipo(equipoId, actor);
    },
    async create(data, actor) {
        for (let attempt = 0;; attempt += 1) {
            try {
                return await database_1.prisma.$transaction(async (tx) => {
                    const division = await tx.division.findFirst({
                        where: (0, authorization_1.isAdmin)(actor) ? { id: data.divisionId } : { id: data.divisionId, liga: { userId: actor.id } },
                        select: { maxEquipos: true },
                    });
                    if (!division)
                        throw new errors_1.NotFoundError('División');
                    const count = await tx.divisionEquipo.count({ where: { divisionId: data.divisionId } });
                    if (count >= division.maxEquipos) {
                        throw new errors_1.ValidationError(`La división ya alcanzó el máximo de ${division.maxEquipos} equipos`);
                    }
                    return repository_1.divisionEquipoRepository.create(data, tx);
                }, { isolationLevel: 'Serializable' });
            }
            catch (error) {
                if (error?.code !== 'P2034' || attempt >= 2)
                    throw error;
            }
        }
    },
    async updateSaldoPendiente(divisionId, equipoId, saldoPendiente, actor) {
        const updated = await repository_1.divisionEquipoRepository.updateSaldoPendiente(divisionId, equipoId, saldoPendiente, actor);
        if (!updated)
            throw new errors_1.NotFoundError('Equipo de la división');
        return { divisionId, equipoId, saldoPendiente };
    },
    async delete(divisionId, equipoId, actor) {
        await assertDivisionOwner(divisionId, actor);
        await database_1.prisma.$transaction(async (tx) => {
            await repository_1.divisionEquipoRepository.delete(divisionId, equipoId, tx);
            await tx.tablaPosicion.deleteMany({ where: { divisionId, equipoId } });
        });
    },
};
//# sourceMappingURL=service.js.map