"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.equipoService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const service_1 = require("../media/service");
const authorization_1 = require("../../utils/authorization");
const transaction_1 = require("../../utils/transaction");
const DUPLICATE_NAME_MESSAGE = 'Ya tienes un equipo con ese nombre';
function isUniqueConstraintError(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
exports.equipoService = {
    async list() {
        return repository_1.equipoRepository.findAll();
    },
    async listByUser(userId) {
        return repository_1.equipoRepository.findByUser(userId);
    },
    async getById(id) {
        const t = await repository_1.equipoRepository.findById(id);
        if (!t)
            throw new errors_1.NotFoundError('Equipo');
        return t;
    },
    async create(data) {
        const nombre = data.nombre.trim();
        const nombreNormalizado = nombre.toLowerCase();
        if (await repository_1.equipoRepository.findByNormalizedName(data.userId, nombreNormalizado)) {
            throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
        }
        try {
            if (data.logoAssetId === undefined)
                return await repository_1.equipoRepository.create({ nombre, nombreNormalizado, userId: data.userId });
            return await (0, transaction_1.runInTransaction)(async (tx) => {
                const media = data.logoAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, data.logoAssetId, data.userId, 'TEAM_LOGO') : undefined;
                return repository_1.equipoRepository.create({
                    nombre,
                    nombreNormalizado,
                    userId: data.userId,
                    ...(media && { logo: media.url, logoPublicId: media.publicId }),
                }, tx);
            });
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            throw error;
        }
    },
    async update(id, data, actor) {
        const old = await this.getById(id);
        (0, authorization_1.assertOwnerOrAdmin)(actor, old.userId, 'Equipo');
        const { logoAssetId, ...updateData } = data;
        if (typeof data.nombre === 'string') {
            const nombre = data.nombre.trim();
            const nombreNormalizado = nombre.toLowerCase();
            updateData.nombre = nombre;
            updateData.nombreNormalizado = nombreNormalizado;
            if (await repository_1.equipoRepository.findByNormalizedName(old.userId, nombreNormalizado, id)) {
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            }
        }
        let updated;
        try {
            if (logoAssetId === undefined)
                return await repository_1.equipoRepository.update(id, updateData);
            updated = await (0, transaction_1.runInTransaction)(async (tx) => {
                await service_1.mediaService.lockAttachmentTarget(tx, 'equipo', id);
                const current = await tx.equipo.findUniqueOrThrow({ where: { id }, select: { logo: true, logoPublicId: true } });
                const media = logoAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, logoAssetId, actor.id, 'TEAM_LOGO', current.logo, current.logoPublicId) : undefined;
                return repository_1.equipoRepository.update(id, { ...updateData, ...(media && { logo: media.url, logoPublicId: media.publicId }) }, tx);
            });
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            throw error;
        }
        return updated;
    },
    async delete(id, actor) {
        const old = await this.getById(id);
        (0, authorization_1.assertOwnerOrAdmin)(actor, old.userId, 'Equipo');
        if (!old.logo) {
            await repository_1.equipoRepository.delete(id);
            return;
        }
        await (0, transaction_1.runInTransaction)(async (tx) => {
            await service_1.mediaService.scheduleImageCleanup(old.logo, old.logoPublicId, tx);
            await repository_1.equipoRepository.delete(id, tx);
        });
    },
};
//# sourceMappingURL=service.js.map