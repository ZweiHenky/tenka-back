"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const service_1 = require("../media/service");
const database_1 = require("../../config/database");
const DUPLICATE_NAME_MESSAGE = 'Ya existe una liga con ese nombre';
function isUniqueConstraintError(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
function validateCanchas(multiplesCanchas, canchas) {
    if (multiplesCanchas && canchas.length < 2) {
        throw new errors_1.ValidationError('Una liga con múltiples canchas debe tener al menos 2 canchas');
    }
    const nombres = canchas.map((cancha) => cancha.nombre.trim().toLocaleLowerCase());
    if (new Set(nombres).size !== nombres.length) {
        throw new errors_1.ValidationError('Los nombres de las canchas no pueden repetirse');
    }
}
function validateArbitros(usaArbitros, arbitros) {
    if (usaArbitros && arbitros.length < 2) {
        throw new errors_1.ValidationError('Debes agregar al menos 2 árbitros');
    }
    const nombres = arbitros.map((a) => a.nombre.trim().toLocaleLowerCase());
    if (new Set(nombres).size !== nombres.length) {
        throw new errors_1.ValidationError('Los nombres de los árbitros no pueden repetirse');
    }
}
exports.ligaService = {
    async list() {
        return repository_1.ligaRepository.findAll();
    },
    async getById(id, actor) {
        const liga = await repository_1.ligaRepository.findVisibleById(id, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        return liga;
    },
    async listByUser(userId, actor) {
        if (actor?.rol === 'ADMINISTRADOR' || actor?.id === userId) {
            return repository_1.ligaRepository.findByUser(userId);
        }
        return repository_1.ligaRepository.findPublicByUser(userId);
    },
    async listPaginated(params) {
        return repository_1.ligaRepository.findAllPaginated(params);
    },
    async create(data) {
        const { canchas, arbitros, ...ligaData } = data;
        validateCanchas(data.multiplesCanchas ?? false, canchas ?? []);
        validateArbitros(data.usaArbitros ?? false, arbitros ?? []);
        const nombre = data.nombre.trim();
        const nombreNormalizado = nombre.toLowerCase();
        if (await repository_1.ligaRepository.findByNormalizedName(nombreNormalizado)) {
            throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
        }
        try {
            return await repository_1.ligaRepository.create({ ...ligaData, nombre, nombreNormalizado }, canchas, arbitros);
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            throw error;
        }
    },
    async update(id, data, actor) {
        const old = await repository_1.ligaRepository.findUpdateContext(id, actor);
        if (!old)
            throw new errors_1.NotFoundError('Liga');
        const { canchas, arbitros, ...ligaData } = data;
        const nextCanchas = canchas ?? old.canchas;
        validateCanchas(data.multiplesCanchas ?? old.multiplesCanchas, nextCanchas);
        const nextArbitros = arbitros ?? old.arbitros;
        validateArbitros(data.usaArbitros ?? old.usaArbitros, nextArbitros);
        if (data.nombre !== undefined) {
            const nombre = data.nombre.trim();
            const nombreNormalizado = nombre.toLowerCase();
            ligaData.nombre = nombre;
            ligaData.nombreNormalizado = nombreNormalizado;
            if (await repository_1.ligaRepository.findByNormalizedName(nombreNormalizado, id)) {
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            }
        }
        let updated;
        try {
            updated = await repository_1.ligaRepository.update(id, ligaData, canchas, arbitros);
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            throw error;
        }
        if (data.logo !== undefined && data.logo !== old.logo) {
            await service_1.mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
        }
        if (data.cancha !== undefined && data.cancha !== old.cancha) {
            await service_1.mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId);
        }
        return updated;
    },
    async delete(id, actor) {
        const old = await repository_1.ligaRepository.findDeleteContext(id, actor);
        if (!old)
            throw new errors_1.NotFoundError('Liga');
        await repository_1.ligaRepository.delete(id);
        await service_1.mediaService.scheduleImageCleanup(old.logo, old.logoPublicId);
        await service_1.mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId);
    },
    async getCanchas(ligaId, actor) {
        const canchas = await repository_1.ligaRepository.findManageableCanchas(ligaId, actor);
        if (!canchas)
            throw new errors_1.NotFoundError('Liga');
        return canchas;
    },
    async createCancha(ligaId, data, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        if (!liga.multiplesCanchas) {
            throw new errors_1.ValidationError('La liga no tiene múltiples canchas habilitadas');
        }
        const existing = await database_1.prisma.ligaCancha.findUnique({
            where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
        });
        if (existing)
            throw new errors_1.ConflictError('Ya existe una cancha con ese nombre en esta liga');
        return database_1.prisma.ligaCancha.create({
            data: { ...data, ligaId },
        });
    },
    async updateCancha(ligaId, canchaId, data, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const cancha = await database_1.prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
        if (!cancha)
            throw new errors_1.NotFoundError('Cancha');
        if (data.nombre && data.nombre !== cancha.nombre) {
            const existing = await database_1.prisma.ligaCancha.findUnique({
                where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
            });
            if (existing)
                throw new errors_1.ConflictError('Ya existe una cancha con ese nombre en esta liga');
        }
        return database_1.prisma.ligaCancha.update({ where: { id: canchaId }, data });
    },
    async deleteCancha(ligaId, canchaId, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const cancha = await database_1.prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
        if (!cancha)
            throw new errors_1.NotFoundError('Cancha');
        const matchCount = await database_1.prisma.partido.count({ where: { canchaId } });
        if (matchCount > 0) {
            await database_1.prisma.ligaCancha.update({ where: { id: canchaId }, data: { activa: false } });
        }
        else {
            await database_1.prisma.ligaCancha.delete({ where: { id: canchaId } });
        }
    },
    async getArbitros(ligaId, actor) {
        const arbitros = await repository_1.ligaRepository.findManageableArbitros(ligaId, actor);
        if (!arbitros)
            throw new errors_1.NotFoundError('Liga');
        return arbitros;
    },
    async getRecentSchedule(ligaId, actor) {
        const schedule = await repository_1.ligaRepository.findRecentSchedule(ligaId, actor);
        if (!schedule)
            throw new errors_1.NotFoundError('Liga');
        return schedule;
    },
    async createArbitro(ligaId, data, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        if (!liga.usaArbitros) {
            throw new errors_1.ValidationError('La liga no tiene árbitros habilitados');
        }
        const existing = await database_1.prisma.ligaArbitro.findUnique({
            where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
        });
        if (existing)
            throw new errors_1.ConflictError('Ya existe un árbitro con ese nombre en esta liga');
        return database_1.prisma.ligaArbitro.create({
            data: { ...data, ligaId },
        });
    },
    async updateArbitro(ligaId, arbitroId, data, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const arbitro = await database_1.prisma.ligaArbitro.findFirst({ where: { id: arbitroId, ligaId } });
        if (!arbitro)
            throw new errors_1.NotFoundError('Árbitro');
        if (liga.usaArbitros && arbitro.activo && data.activo === false) {
            const remainingActive = await database_1.prisma.ligaArbitro.count({
                where: { ligaId, activo: true, id: { not: arbitroId } },
            });
            if (remainingActive < 2) {
                throw new errors_1.ValidationError('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
            }
        }
        if (data.nombre && data.nombre !== arbitro.nombre) {
            const existing = await database_1.prisma.ligaArbitro.findUnique({
                where: { ligaId_nombre: { ligaId, nombre: data.nombre } },
            });
            if (existing)
                throw new errors_1.ConflictError('Ya existe un árbitro con ese nombre en esta liga');
        }
        return database_1.prisma.ligaArbitro.update({ where: { id: arbitroId }, data });
    },
    async deleteArbitro(ligaId, arbitroId, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const arbitro = await database_1.prisma.ligaArbitro.findFirst({ where: { id: arbitroId, ligaId } });
        if (!arbitro)
            throw new errors_1.NotFoundError('Árbitro');
        if (liga.usaArbitros && arbitro.activo) {
            const remainingActive = await database_1.prisma.ligaArbitro.count({
                where: { ligaId, activo: true, id: { not: arbitroId } },
            });
            if (remainingActive < 2) {
                throw new errors_1.ValidationError('Una liga con árbitros habilitados debe conservar al menos 2 árbitros activos');
            }
        }
        const matchCount = await database_1.prisma.partidoArbitro.count({ where: { arbitroId } });
        if (matchCount > 0) {
            await database_1.prisma.ligaArbitro.update({ where: { id: arbitroId }, data: { activo: false } });
        }
        else {
            await database_1.prisma.ligaArbitro.delete({ where: { id: arbitroId } });
        }
    },
};
//# sourceMappingURL=service.js.map