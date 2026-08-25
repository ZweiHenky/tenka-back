import { prisma } from '../../config/database';
import type { DivisionEntity } from './entity';
import type { DivisionRepository } from './repository.interface';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Las escrituras deben devolver la división completa: el cliente guarda la respuesta en su
 * caché, y si faltara `canchaHorarios` la división parecería no tener configuración por cancha
 * hasta el siguiente refetch — cayendo al fallback legacy y mostrando todas las canchas.
 */
const DIVISION_WRITE_INCLUDE = {
  canchaHorarios: { select: { canchaId: true, diasPartido: true, horarioPartido: true } },
} as const;

export const divisionRepository: DivisionRepository = {
  async findAll(): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async findById(id: string): Promise<DivisionEntity | null> {
    return prisma.division.findUnique({
      where: { id },
      include: {
        liga: { select: { id: true, nombre: true, logo: true } },
        estadoLiga: { select: { id: true, nombre: true } },
      },
    }) as any;
  },

  async findByLiga(ligaId: string): Promise<DivisionEntity[]> {
    return prisma.division.findMany({ where: { ligaId }, orderBy: { createdAt: 'desc' } });
  },

  async create(data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<DivisionEntity> {
    return (tx ?? prisma).division.create({ data: data as any, include: DIVISION_WRITE_INCLUDE });
  },

  async update(id: string, data: Record<string, unknown>, tx?: Prisma.TransactionClient): Promise<DivisionEntity> {
    return (tx ?? prisma).division.update({ where: { id }, data, include: DIVISION_WRITE_INCLUDE });
  },

  async delete(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? prisma).division.delete({ where: { id } });
  },
};
