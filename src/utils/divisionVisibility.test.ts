import { describe, expect, it } from 'vitest';
import { visibleDivisionWhere } from './divisionVisibility';
import type { AuthenticatedUser } from '../types/auth';

const owner: AuthenticatedUser = { id: 'owner-1', email: 'owner@test.com', rol: 'LIGA' };
const admin: AuthenticatedUser = { id: 'admin-1', email: 'admin@test.com', rol: 'ADMINISTRADOR' };

/**
 * El bug que cierra esto: la visibilidad se decidía comparando el NOMBRE del catálogo, y el
 * catálogo es editable por API. Renombrar la fila "Borrador" hacía cierto `nombre != 'Borrador'`
 * para todas y publicaba de golpe todos los borradores.
 */
describe('visibleDivisionWhere', () => {
  it('filtra por código y no menciona el nombre en ninguna parte', () => {
    const where = visibleDivisionWhere();
    expect(where).toEqual({ estadoLiga: { codigo: { not: 'BORRADOR' } } });
    expect(JSON.stringify(where)).not.toContain('nombre');
    expect(JSON.stringify(where)).not.toContain('Borrador"');
  });

  it('al dueño le suma sus propias divisiones, sin aflojar el filtro público', () => {
    expect(visibleDivisionWhere(owner)).toEqual({
      OR: [
        { estadoLiga: { codigo: { not: 'BORRADOR' } } },
        { liga: { userId: owner.id } },
      ],
    });
  });

  it('el administrador no lleva filtro', () => {
    expect(visibleDivisionWhere(admin)).toEqual({});
  });
});
