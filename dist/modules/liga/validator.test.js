"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
const baseLiga = {
    nombre: 'Liga prueba',
    descripcion: '',
    ubicacionId: 'ubicacion-1',
};
(0, vitest_1.describe)('validacion de canchas de liga', () => {
    (0, vitest_1.it)('recorta el nombre de la liga', () => {
        const result = validator_1.createLigaSchema.parse({ ...baseLiga, nombre: '  Liga prueba  ' });
        (0, vitest_1.expect)(result.nombre).toBe('Liga prueba');
    });
    (0, vitest_1.it)('permite una liga sin multiples canchas', () => {
        (0, vitest_1.expect)(validator_1.createLigaSchema.safeParse(baseLiga).success).toBe(true);
    });
    (0, vitest_1.it)('rechaza multiples canchas sin al menos dos registros', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            multiplesCanchas: true,
            canchas: [{ nombre: 'Cancha 1' }],
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error.issues[0].message).toBe('Una liga con múltiples canchas debe tener al menos 2 canchas');
        }
    });
    (0, vitest_1.it)('acepta multiples canchas con dos nombres distintos', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            multiplesCanchas: true,
            canchas: [{ nombre: 'Cancha 1' }, { nombre: 'Cancha 2' }],
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)('rechaza nombres repetidos ignorando mayusculas', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            multiplesCanchas: true,
            canchas: [{ nombre: 'Principal' }, { nombre: 'principal' }],
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error.issues[0].message).toBe('Los nombres de las canchas no pueden repetirse');
        }
    });
    (0, vitest_1.it)('permite actualizaciones parciales y deja la validacion final al servicio', () => {
        (0, vitest_1.expect)(validator_1.updateLigaSchema.safeParse({ multiplesCanchas: true }).success).toBe(true);
    });
    (0, vitest_1.it)('acepta ids y estado activo en las canchas de una actualizacion', () => {
        const result = validator_1.updateLigaSchema.parse({
            canchas: [
                { id: 'cancha-1', nombre: '  Principal  ', activa: true },
                { id: 'cancha-2', activa: false },
            ],
        });
        (0, vitest_1.expect)(result.canchas).toEqual([
            { id: 'cancha-1', nombre: 'Principal', activa: true },
            { id: 'cancha-2', activa: false },
        ]);
    });
    (0, vitest_1.it)('exige nombre para una cancha nueva en una actualizacion', () => {
        (0, vitest_1.expect)(validator_1.updateLigaSchema.safeParse({ canchas: [{ activa: true }] }).success).toBe(false);
    });
});
(0, vitest_1.describe)('validacion de arbitros de liga', () => {
    (0, vitest_1.it)('rechaza una liga con arbitros habilitados y un solo arbitro', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            usaArbitros: true,
            arbitros: [{ nombre: 'Árbitro 1' }],
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error.issues[0].message).toBe('Debes agregar al menos 2 árbitros');
        }
    });
    (0, vitest_1.it)('acepta una liga con dos arbitros distintos', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            usaArbitros: true,
            arbitros: [{ nombre: 'Árbitro 1' }, { nombre: 'Árbitro 2' }],
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)('rechaza una edicion explicita que deje un solo arbitro', () => {
        const result = validator_1.updateLigaSchema.safeParse({
            usaArbitros: true,
            arbitros: [{ nombre: 'Árbitro 1' }],
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)('mantiene el rechazo de nombres repetidos', () => {
        const result = validator_1.createLigaSchema.safeParse({
            ...baseLiga,
            usaArbitros: true,
            arbitros: [{ nombre: 'Principal' }, { nombre: 'principal' }],
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error.issues[0].message).toBe('Los nombres de los árbitros no pueden repetirse');
        }
    });
});
//# sourceMappingURL=validator.test.js.map