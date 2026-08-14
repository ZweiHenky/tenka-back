import { prisma } from '../../config/database';
import type { UbicacionEntity } from './entity';
import type { UbicacionRepository } from './repository.interface';

export const ubicacionRepository: UbicacionRepository = {
  async findAll(): Promise<UbicacionEntity[]> {
    return prisma.ubicacion.findMany({ orderBy: { nombreCompleto: 'asc' } });
  },

  async findAllPaginated({ skip, take }): Promise<{ rows: UbicacionEntity[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.ubicacion.findMany({ orderBy: { nombreCompleto: 'asc' }, skip, take }),
      prisma.ubicacion.count(),
    ]);
    return { rows, total };
  },

  async findById(id: string): Promise<UbicacionEntity | null> {
    return prisma.ubicacion.findUnique({ where: { id } });
  },

  async findOrCreate(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string; timeZone: string }): Promise<UbicacionEntity> {
    const existing = await prisma.ubicacion.findFirst({ where: { nombreCompleto: data.nombreCompleto, estado: data.estado } });
    if (existing) return existing.timeZone === data.timeZone ? existing : prisma.ubicacion.update({ where: { id: existing.id }, data: { timeZone: data.timeZone, lat: data.lat, lng: data.lng } });
    return prisma.ubicacion.create({ data });
  },

  async create(data: { lat: number; lng: number; nombreCompleto: string; estado: string; municipio: string; timeZone: string }): Promise<UbicacionEntity> {
    return prisma.ubicacion.create({ data });
  },

  async update(id: string, data: Record<string, unknown>): Promise<UbicacionEntity> {
    return prisma.ubicacion.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.ubicacion.delete({ where: { id } });
  },
};
