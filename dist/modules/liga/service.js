"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const service_1 = require("../media/service");
const database_1 = require("../../config/database");
const transaction_1 = require("../../utils/transaction");
const jobSignals_1 = require("../../workers/jobSignals");
const DUPLICATE_NAME_MESSAGE = 'Ya existe una liga con ese nombre';
const DUPLICATE_COURT_MESSAGE = 'Ya existe una cancha con ese nombre en esta liga';
const MINIMUM_COURTS_MESSAGE = 'Una liga con múltiples canchas debe conservar al menos 2 canchas activas';
function normalizeName(nombre) {
    return nombre.trim().toLowerCase();
}
function isUniqueConstraintError(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
function isCourtUniqueConstraintError(error) {
    if (!isUniqueConstraintError(error) || typeof error !== 'object' || error === null || !('meta' in error))
        return false;
    const target = error.meta?.target;
    return Array.isArray(target)
        ? target.includes('nombreNormalizado')
        : typeof target === 'string' && target.includes('nombreNormalizado');
}
function validateCanchas(multiplesCanchas, canchas) {
    if (multiplesCanchas && canchas.length < 2) {
        throw new errors_1.ValidationError('Una liga con múltiples canchas debe tener al menos 2 canchas');
    }
    const nombres = canchas.map((cancha) => cancha.nombre.trim().toLowerCase());
    if (new Set(nombres).size !== nombres.length) {
        throw new errors_1.ValidationError('Los nombres de las canchas no pueden repetirse');
    }
}
function reconcileCanchas(current, incoming, multiplesCanchas) {
    const currentById = new Map(current.map((cancha) => [cancha.id, cancha]));
    const incomingIds = incoming.flatMap((cancha) => cancha.id ? [cancha.id] : []);
    if (new Set(incomingIds).size !== incomingIds.length) {
        throw new errors_1.ValidationError('Una cancha no puede aparecer más de una vez');
    }
    for (const id of incomingIds) {
        if (!currentById.has(id))
            throw new errors_1.ValidationError('La cancha indicada no pertenece a esta liga');
    }
    const requestedById = new Map(incoming.flatMap((cancha) => cancha.id ? [[cancha.id, cancha]] : []));
    const reconciled = current.map((cancha) => {
        const requested = requestedById.get(cancha.id);
        const nombre = requested?.nombre?.trim() ?? cancha.nombre;
        return {
            id: cancha.id,
            nombre,
            nombreNormalizado: normalizeName(nombre),
            nombreNormalizadoAnterior: cancha.nombreNormalizado,
            activa: multiplesCanchas && requested !== undefined ? (requested.activa ?? cancha.activa) : false,
        };
    });
    for (const cancha of incoming) {
        if (cancha.id)
            continue;
        const nombre = cancha.nombre.trim();
        reconciled.push({
            nombre,
            nombreNormalizado: normalizeName(nombre),
            activa: multiplesCanchas && (cancha.activa ?? true),
        });
    }
    const normalizedNames = reconciled.map((cancha) => cancha.nombreNormalizado);
    if (new Set(normalizedNames).size !== normalizedNames.length) {
        throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
    }
    if (multiplesCanchas && reconciled.filter((cancha) => cancha.activa).length < 2) {
        throw new errors_1.ValidationError(MINIMUM_COURTS_MESSAGE);
    }
    return reconciled;
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
        const { canchas, arbitros, logoAssetId, coverAssetId, ...ligaData } = data;
        const location = await database_1.prisma.ubicacion.findUnique({ where: { id: data.ubicacionId }, select: { timeZone: true } });
        if (!location)
            throw new errors_1.NotFoundError('Ubicación');
        const authoritativeLigaData = { ...ligaData, timeZone: location.timeZone };
        validateCanchas(data.multiplesCanchas ?? false, canchas ?? []);
        validateArbitros(data.usaArbitros ?? false, arbitros ?? []);
        const nombre = data.nombre.trim();
        const nombreNormalizado = normalizeName(nombre);
        if (await repository_1.ligaRepository.findByNormalizedName(nombreNormalizado)) {
            throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
        }
        try {
            const courtWrites = canchas?.map((cancha) => ({
                nombre: cancha.nombre.trim(),
                nombreNormalizado: normalizeName(cancha.nombre),
                activa: data.multiplesCanchas === true,
            }));
            if (logoAssetId === undefined && coverAssetId === undefined) {
                return await repository_1.ligaRepository.create({ ...authoritativeLigaData, nombre, nombreNormalizado }, courtWrites, arbitros);
            }
            return await (0, transaction_1.runInTransaction)(async (tx) => {
                const logo = logoAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, logoAssetId, data.userId, 'LEAGUE_LOGO') : undefined;
                const cover = coverAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, coverAssetId, data.userId, 'LEAGUE_COVER') : undefined;
                return repository_1.ligaRepository.create({
                    ...authoritativeLigaData,
                    nombre,
                    nombreNormalizado,
                    ...(logo && { logo: logo.url, logoPublicId: logo.publicId }),
                    ...(cover && { cancha: cover.url, canchaPublicId: cover.publicId }),
                }, courtWrites, arbitros, tx);
            });
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
        const { canchas, arbitros, logoAssetId, coverAssetId, ...rawLigaData } = data;
        const ligaData = rawLigaData;
        if (data.ubicacionId) {
            const location = await database_1.prisma.ubicacion.findUnique({ where: { id: data.ubicacionId }, select: { timeZone: true } });
            if (!location)
                throw new errors_1.NotFoundError('Ubicación');
            ligaData.timeZone = location.timeZone;
        }
        const multiplesCanchas = data.multiplesCanchas ?? old.multiplesCanchas;
        let courtWrites;
        if (canchas !== undefined) {
            courtWrites = reconcileCanchas(old.canchas, canchas, multiplesCanchas);
        }
        else if (!multiplesCanchas) {
            courtWrites = reconcileCanchas(old.canchas, [], false);
        }
        else if (old.canchas.filter((cancha) => cancha.activa).length < 2) {
            throw new errors_1.ValidationError(MINIMUM_COURTS_MESSAGE);
        }
        const nextArbitros = arbitros ?? old.arbitros;
        validateArbitros(data.usaArbitros ?? old.usaArbitros, nextArbitros);
        if (data.nombre !== undefined) {
            const nombre = data.nombre.trim();
            const nombreNormalizado = normalizeName(nombre);
            ligaData.nombre = nombre;
            ligaData.nombreNormalizado = nombreNormalizado;
            if (await repository_1.ligaRepository.findByNormalizedName(nombreNormalizado, id)) {
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            }
        }
        let updated;
        try {
            const disablingMultipleCourts = old.multiplesCanchas && data.multiplesCanchas === false;
            if (logoAssetId === undefined && coverAssetId === undefined) {
                updated = disablingMultipleCourts
                    ? await repository_1.ligaRepository.update(id, ligaData, courtWrites, arbitros, true)
                    : await repository_1.ligaRepository.update(id, ligaData, courtWrites, arbitros);
            }
            else
                updated = await (0, transaction_1.runInTransaction)(async (tx) => {
                    await service_1.mediaService.lockAttachmentTarget(tx, 'liga', id);
                    const current = await tx.liga.findUniqueOrThrow({
                        where: { id },
                        select: { logo: true, logoPublicId: true, cancha: true, canchaPublicId: true },
                    });
                    const logo = logoAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, logoAssetId, actor.id, 'LEAGUE_LOGO', current.logo, current.logoPublicId) : undefined;
                    const cover = coverAssetId !== undefined ? await service_1.mediaService.prepareAttachment(tx, coverAssetId, actor.id, 'LEAGUE_COVER', current.cancha, current.canchaPublicId) : undefined;
                    const writeData = {
                        ...ligaData,
                        ...(logo && { logo: logo.url, logoPublicId: logo.publicId }),
                        ...(cover && { cancha: cover.url, canchaPublicId: cover.publicId }),
                    };
                    return repository_1.ligaRepository.update(id, writeData, courtWrites, arbitros, disablingMultipleCourts, tx);
                });
            (0, jobSignals_1.signalBackgroundJob)('media-deletion');
        }
        catch (error) {
            if (isCourtUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_NAME_MESSAGE);
            throw error;
        }
        return updated;
    },
    async delete(id, actor) {
        const old = await repository_1.ligaRepository.findDeleteContext(id, actor);
        if (!old)
            throw new errors_1.NotFoundError('Liga');
        if (!old.logo && !old.cancha) {
            await repository_1.ligaRepository.delete(id);
            return;
        }
        await (0, transaction_1.runInTransaction)(async (tx) => {
            await service_1.mediaService.scheduleImageCleanup(old.logo, old.logoPublicId, tx);
            await service_1.mediaService.scheduleImageCleanup(old.cancha, old.canchaPublicId, tx);
            await repository_1.ligaRepository.delete(id, 'liga' in tx ? tx : undefined);
        });
        (0, jobSignals_1.signalBackgroundJob)('media-deletion');
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
        const nombre = data.nombre.trim();
        const nombreNormalizado = normalizeName(nombre);
        const existing = await database_1.prisma.ligaCancha.findFirst({ where: { ligaId, nombreNormalizado } });
        if (existing)
            throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
        try {
            return await database_1.prisma.ligaCancha.create({ data: { nombre, nombreNormalizado, ligaId } });
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
            throw error;
        }
    },
    async updateCancha(ligaId, canchaId, data, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const cancha = await database_1.prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
        if (!cancha)
            throw new errors_1.NotFoundError('Cancha');
        if (!liga.multiplesCanchas && data.activa === true) {
            throw new errors_1.ValidationError('Una liga sin múltiples canchas no puede tener canchas activas');
        }
        if (liga.multiplesCanchas && cancha.activa && data.activa === false) {
            const remainingActive = await database_1.prisma.ligaCancha.count({
                where: { ligaId, activa: true, id: { not: canchaId } },
            });
            if (remainingActive < 2)
                throw new errors_1.ValidationError(MINIMUM_COURTS_MESSAGE);
        }
        const updateData = {};
        if (data.activa !== undefined)
            updateData.activa = data.activa;
        if (data.nombre !== undefined) {
            const nombre = data.nombre.trim();
            const nombreNormalizado = normalizeName(nombre);
            const existing = await database_1.prisma.ligaCancha.findFirst({
                where: { ligaId, nombreNormalizado, id: { not: canchaId } },
            });
            if (existing)
                throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
            updateData.nombre = nombre;
            updateData.nombreNormalizado = nombreNormalizado;
        }
        try {
            return await database_1.prisma.ligaCancha.update({ where: { id: canchaId }, data: updateData });
        }
        catch (error) {
            if (isUniqueConstraintError(error))
                throw new errors_1.ConflictError(DUPLICATE_COURT_MESSAGE);
            throw error;
        }
    },
    async deleteCancha(ligaId, canchaId, actor) {
        const liga = await repository_1.ligaRepository.findManagementContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const cancha = await database_1.prisma.ligaCancha.findFirst({ where: { id: canchaId, ligaId } });
        if (!cancha)
            throw new errors_1.NotFoundError('Cancha');
        if (liga.multiplesCanchas && cancha.activa) {
            const remainingActive = await database_1.prisma.ligaCancha.count({
                where: { ligaId, activa: true, id: { not: canchaId } },
            });
            if (remainingActive < 2)
                throw new errors_1.ValidationError(MINIMUM_COURTS_MESSAGE);
        }
        const [matchCount, fixedDivisionCount] = await Promise.all([
            database_1.prisma.partido.count({ where: { canchaId } }),
            database_1.prisma.division.count({ where: { canchaUnicaId: canchaId } }),
        ]);
        if (matchCount > 0 || fixedDivisionCount > 0) {
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