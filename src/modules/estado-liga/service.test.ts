import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('./repository', () => ({ estadoLigaRepository: { ...mocks, findAll: vi.fn(), create: vi.fn() } }));

import { estadoLigaService } from './service';

describe('estadoLigaService canonical codes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the display name', async () => {
    mocks.findById.mockResolvedValue({ id: 'state-1', nombre: 'Abierta', codigo: 'ABIERTA' });
    mocks.update.mockResolvedValue({ id: 'state-1', nombre: 'Inscripciones', codigo: 'ABIERTA' });
    await estadoLigaService.update('state-1', { nombre: 'Inscripciones' });
    expect(mocks.update).toHaveBeenCalledWith('state-1', { nombre: 'Inscripciones' });
  });

  it.each(['BORRADOR', 'ABIERTA', 'EN_CURSO', 'FINALIZADA', 'CANCELADA'])('protects canonical code %s from deletion', async (codigo) => {
    mocks.findById.mockResolvedValue({ id: 'state-1', nombre: codigo, codigo });
    await expect(estadoLigaService.delete('state-1')).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('allows deleting a non-canonical extension state', async () => {
    mocks.findById.mockResolvedValue({ id: 'state-1', nombre: 'Pausada', codigo: 'PAUSADA' });
    await estadoLigaService.delete('state-1');
    expect(mocks.delete).toHaveBeenCalledWith('state-1');
  });
});
