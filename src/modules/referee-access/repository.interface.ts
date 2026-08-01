import type { PartidoRefereeAccessEntity, RefereePartidoReadContext } from './entity'

export interface PartidoRefereeAccessRepository {
  findByTokenHash(tokenHash: string): Promise<PartidoRefereeAccessEntity | null>
  findPartidoReadContextByTokenHash(tokenHash: string): Promise<RefereePartidoReadContext | null>
  findByPartidoId(partidoId: string): Promise<PartidoRefereeAccessEntity | null>
  upsert(data: { tokenHash: string; partidoId: string; createdById: string; expiresAt: Date }): Promise<PartidoRefereeAccessEntity>
  markUsedInTx(tx: any, id: string): Promise<void>
  delete(id: string): Promise<void>
}
