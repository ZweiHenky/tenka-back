import type { Prisma } from '../generated/prisma/client';

/** Lo mínimo que necesita esta consulta; sirve tanto `prisma` como una transacción. */
type BracketClient = Pick<Prisma.TransactionClient, 'rondaPlayoff'>;

/**
 * El cuadro terminó: la ronda de `orden` máximo existe, tiene partidos y todos están `FINALIZADO`.
 *
 * La final es la ronda de **orden máximo**, no la que se llama "Final": ese nombre es texto libre
 * y la API deja editarlo.
 *
 * Una sola definición para los dos que la preguntan —el gate del campeón y el cierre automático de
 * la división al guardar el resultado de la final—, porque dos copias divergen.
 */
export async function isCuadroCompleto(client: BracketClient, divisionId: string): Promise<boolean> {
  const ultimaRonda = await client.rondaPlayoff.findFirst({
    where: { divisionId },
    orderBy: { orden: 'desc' },
    select: { partidos: { select: { estado: true } } },
  });
  const partidos = ultimaRonda?.partidos ?? [];
  return partidos.length > 0 && partidos.every((partido) => partido.estado === 'FINALIZADO');
}
