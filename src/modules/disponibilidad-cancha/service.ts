import type { AuthenticatedUser } from '../../types/auth';
import { NotFoundError } from '../../utils/errors';
import type { DisponibilidadCanchas, PartidoOcupacion } from './entity';
import { disponibilidadCanchaRepository } from './repository';
import type { DisponibilidadCanchaRepository } from './repository.interface';

export class DisponibilidadCanchaService {
  constructor(private readonly repository: DisponibilidadCanchaRepository = disponibilidadCanchaRepository) {}

  async get(ligaId: string, inicio: Date, fin: Date, actor: AuthenticatedUser): Promise<DisponibilidadCanchas> {
    const liga = await this.repository.findLeagueContext(ligaId, actor);
    if (!liga) throw new NotFoundError('Liga');

    const ocupaciones = await this.repository.findOccupancy(ligaId, inicio, fin);
    const mode = liga.multiplesCanchas ? 'MULTIPLE' : 'SINGLE';
    const asignaciones: Record<string, PartidoOcupacion[]> = {};
    const partidosSinCancha: PartidoOcupacion[] = [];

    if (mode === 'MULTIPLE') {
      for (const partido of ocupaciones) {
        if (partido.canchaId) (asignaciones[partido.canchaId] ??= []).push(partido);
        else partidosSinCancha.push(partido);
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

export const disponibilidadCanchaService = new DisponibilidadCanchaService();
