"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.premioService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
const database_1 = require("../../config/database");
const authorization_1 = require("../../utils/authorization");
const divisionVisibility_1 = require("../../utils/divisionVisibility");
async function assertDivisionOwner(divisionId, actor) {
    const division = await database_1.prisma.division.findUnique({
        where: { id: divisionId },
        select: { liga: { select: { userId: true } } },
    });
    if (!division)
        throw new errors_1.NotFoundError('División');
    (0, authorization_1.assertOwnerOrAdmin)(actor, division.liga.userId, 'División');
}
async function findForWrite(id, actor) {
    const premio = await repository_1.premioRepository.findById(id);
    if (!premio)
        throw new errors_1.NotFoundError('Premio');
    await (0, divisionVisibility_1.assertVisibleDivision)(premio.divisionId, actor);
    return premio;
}
exports.premioService = {
    async list(pagination, actor) {
        const where = { division: (0, divisionVisibility_1.visibleDivisionWhere)(actor) };
        const [rows, total] = await Promise.all([
            database_1.prisma.premio.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
            database_1.prisma.premio.count({ where }),
        ]);
        return { rows, total };
    },
    async getById(id, actor) {
        const t = await repository_1.premioRepository.findVisibleById(id, actor);
        if (!t)
            throw new errors_1.NotFoundError('Premio');
        return t;
    },
    async findByDivision(divisionId, actor) {
        const premios = await repository_1.premioRepository.findVisibleByDivision(divisionId, actor);
        if (!premios)
            throw new errors_1.NotFoundError('División');
        return premios;
    },
    async create(data, actor) {
        await assertDivisionOwner(data.divisionId, actor);
        return repository_1.premioRepository.create(data);
    },
    async update(id, data, actor) {
        const premio = await findForWrite(id, actor);
        await assertDivisionOwner(premio.divisionId, actor);
        return repository_1.premioRepository.update(id, data);
    },
    async delete(id, actor) {
        const premio = await findForWrite(id, actor);
        await assertDivisionOwner(premio.divisionId, actor);
        await repository_1.premioRepository.delete(id);
    },
};
//# sourceMappingURL=service.js.map