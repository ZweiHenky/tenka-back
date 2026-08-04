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
async function getDivisionUpdateContext(id, actor) {
    const division = await database_1.prisma.division.findFirst({
        where: (0, authorization_1.isAdmin)(actor) ? { id } : { id, liga: { userId: actor.id } },
        select: { id: true, ligaId: true, canchaUnicaId: true },
    });
    if (!division)
        throw new errors_1.NotFoundError('Division');
    return division;
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
        const division = await getDivisionUpdateContext(id, actor);
        if (data.ligaId)
            await assertLigaOwner(data.ligaId, actor);
        const ligaId = data.ligaId ?? division.ligaId;
        let updateData = data;
        if (data.ligaId && data.canchaUnicaId === undefined && division.canchaUnicaId) {
            updateData = { ...data, canchaUnicaId: null };
        }
        if (data.canchaUnicaId) {
            const cancha = await database_1.prisma.ligaCancha.findFirst({
                where: { id: data.canchaUnicaId },
                select: { ligaId: true, activa: true, liga: { select: { multiplesCanchas: true } } },
            });
            if (!cancha || cancha.ligaId !== ligaId) {
                throw new errors_1.ValidationError('La cancha indicada no pertenece a esta liga');
            }
            if (!cancha.liga.multiplesCanchas) {
                throw new errors_1.ValidationError('La liga no tiene múltiples canchas habilitadas');
            }
            if (!cancha.activa)
                throw new errors_1.ValidationError('La cancha seleccionada no está activa');
        }
        return repository_1.divisionRepository.update(id, updateData);
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
                for (const { oneSignalId } of subscriptions) {
                    await tx.oneSignalTagCleanupJob.upsert({
                        where: { oneSignalId_tag: { oneSignalId, tag } },
                        create: { oneSignalId, tag, desired: false },
                        update: { desired: false, status: 'PENDING', attempts: 0, lastError: null, deadAt: null, leaseUntil: null, lockedBy: null, nextTryAt: new Date() },
                    });
                }
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