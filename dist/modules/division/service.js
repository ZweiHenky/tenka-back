"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divisionService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const database_1 = require("../../config/database");
const authorization_1 = require("../../utils/authorization");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
async function assertLigaOwner(ligaId, actor) {
    const liga = await database_1.prisma.liga.findFirst({
        where: (0, authorization_1.isAdmin)(actor) ? { id: ligaId } : { id: ligaId, userId: actor.id },
        select: { id: true },
    });
    if (!liga)
        throw new errors_1.NotFoundError('Liga');
}
async function assertDivisionOwner(id, actor) {
    const division = await database_1.prisma.division.findFirst({
        where: (0, authorization_1.isAdmin)(actor) ? { id } : { id, liga: { userId: actor.id } },
        select: { id: true },
    });
    if (!division)
        throw new errors_1.NotFoundError('Division');
}
exports.divisionService = {
    async list(actor) {
        return database_1.prisma.division.findMany({ where: (0, divisionVisibility_1.visibleDivisionWhere)(actor), orderBy: { createdAt: 'desc' } });
    },
    async getById(id, actor) {
        const division = await database_1.prisma.division.findFirst({
            where: { id, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) },
            include: { liga: { select: { id: true, nombre: true, logo: true } }, estadoLiga: { select: { id: true, nombre: true } } },
        });
        if (!division)
            throw new errors_1.NotFoundError('Division');
        return division;
    },
    async listByLiga(ligaId, actor) {
        return database_1.prisma.division.findMany({ where: { ligaId, ...(0, divisionVisibility_1.visibleDivisionWhere)(actor) }, orderBy: { createdAt: 'desc' } });
    },
    async create(data, actor) {
        await assertLigaOwner(data.ligaId, actor);
        const estadoLigaId = data.estadoLigaId ?? (await database_1.prisma.estadoLiga.findFirstOrThrow({
            where: { nombre: 'Borrador' },
            select: { id: true },
        })).id;
        return repository_1.divisionRepository.create({ ...data, estadoLigaId });
    },
    async update(id, data, actor) {
        await assertDivisionOwner(id, actor);
        if (data.ligaId)
            await assertLigaOwner(data.ligaId, actor);
        return repository_1.divisionRepository.update(id, data);
    },
    async delete(id, actor) {
        await assertDivisionOwner(id, actor);
        await database_1.prisma.$transaction(async (tx) => {
            const subscriptions = await tx.divisionNotificationSubscription.findMany({
                where: { divisionId: id },
                select: { oneSignalId: true },
            });
            if (subscriptions.length) {
                const tag = `division_${id}`;
                await tx.oneSignalTagCleanupJob.createMany({
                    data: subscriptions.map(({ oneSignalId }) => ({ oneSignalId, tag })),
                    skipDuplicates: true,
                });
            }
            await repository_1.divisionRepository.delete(id, tx);
        });
    },
    async resetDivision(divisionId, actor) {
        await assertDivisionOwner(divisionId, actor);
        await database_1.prisma.$transaction(async (tx) => {
            await tx.jornada.deleteMany({ where: { divisionId } });
            await tx.rondaPlayoff.deleteMany({ where: { divisionId } });
            await tx.tablaPosicion.deleteMany({ where: { divisionId } });
        });
    },
};
//# sourceMappingURL=service.js.map