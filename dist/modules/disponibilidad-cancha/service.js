"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.disponibilidadCanchaService = exports.DisponibilidadCanchaService = void 0;
const errors_1 = require("../../utils/errors");
const repository_1 = require("./repository");
class DisponibilidadCanchaService {
    constructor(repository = repository_1.disponibilidadCanchaRepository) {
        this.repository = repository;
    }
    async get(ligaId, inicio, fin, actor) {
        var _a;
        const liga = await this.repository.findLeagueContext(ligaId, actor);
        if (!liga)
            throw new errors_1.NotFoundError('Liga');
        const ocupaciones = await this.repository.findOccupancy(ligaId, inicio, fin);
        const mode = liga.multiplesCanchas ? 'MULTIPLE' : 'SINGLE';
        const asignaciones = {};
        const partidosSinCancha = [];
        if (mode === 'MULTIPLE') {
            for (const partido of ocupaciones) {
                if (partido.canchaId)
                    (asignaciones[_a = partido.canchaId] ?? (asignaciones[_a] = [])).push(partido);
                else
                    partidosSinCancha.push(partido);
            }
        }
        return {
            ligaId: liga.id,
            mode,
            inicio,
            fin,
            canchas: mode === 'MULTIPLE' ? liga.canchas : [],
            ocupaciones,
            asignaciones,
            partidosSinCancha,
        };
    }
}
exports.DisponibilidadCanchaService = DisponibilidadCanchaService;
exports.disponibilidadCanchaService = new DisponibilidadCanchaService();
//# sourceMappingURL=service.js.map