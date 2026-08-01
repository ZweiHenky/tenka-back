import { describe, expect, it } from 'vitest';
import { createLigaSchema, updateLigaSchema } from './validator';

const baseLiga = {
  nombre: 'Liga prueba',
  descripcion: '',
  ubicacionId: 'ubicacion-1',
};

describe('validacion de canchas de liga', () => {
  it('recorta el nombre de la liga', () => {
    const result = createLigaSchema.parse({ ...baseLiga, nombre: '  Liga prueba  ' });
    expect(result.nombre).toBe('Liga prueba');
  });

  it('permite una liga sin multiples canchas', () => {
    expect(createLigaSchema.safeParse(baseLiga).success).toBe(true);
  });

  it('rechaza multiples canchas sin al menos dos registros', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      multiplesCanchas: true,
      canchas: [{ nombre: 'Cancha 1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Una liga con múltiples canchas debe tener al menos 2 canchas',
      );
    }
  });

  it('acepta multiples canchas con dos nombres distintos', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      multiplesCanchas: true,
      canchas: [{ nombre: 'Cancha 1' }, { nombre: 'Cancha 2' }],
    });

    expect(result.success).toBe(true);
  });

  it('rechaza nombres repetidos ignorando mayusculas', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      multiplesCanchas: true,
      canchas: [{ nombre: 'Principal' }, { nombre: 'principal' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Los nombres de las canchas no pueden repetirse',
      );
    }
  });

  it('permite actualizaciones parciales y deja la validacion final al servicio', () => {
    expect(updateLigaSchema.safeParse({ multiplesCanchas: true }).success).toBe(true);
  });
});

describe('validacion de arbitros de liga', () => {
  it('rechaza una liga con arbitros habilitados y un solo arbitro', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      usaArbitros: true,
      arbitros: [{ nombre: 'Árbitro 1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Debes agregar al menos 2 árbitros');
    }
  });

  it('acepta una liga con dos arbitros distintos', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      usaArbitros: true,
      arbitros: [{ nombre: 'Árbitro 1' }, { nombre: 'Árbitro 2' }],
    });

    expect(result.success).toBe(true);
  });

  it('rechaza una edicion explicita que deje un solo arbitro', () => {
    const result = updateLigaSchema.safeParse({
      usaArbitros: true,
      arbitros: [{ nombre: 'Árbitro 1' }],
    });

    expect(result.success).toBe(false);
  });

  it('mantiene el rechazo de nombres repetidos', () => {
    const result = createLigaSchema.safeParse({
      ...baseLiga,
      usaArbitros: true,
      arbitros: [{ nombre: 'Principal' }, { nombre: 'principal' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Los nombres de los árbitros no pueden repetirse');
    }
  });
});
