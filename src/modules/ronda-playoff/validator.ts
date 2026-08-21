import { z } from 'zod';

export const createSchema = z.object({
  nombre: z.string().min(1),
  orden: z.number().int().min(1),
  divisionId: z.string().min(1),
});

export const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  orden: z.number().int().min(1).optional(),
});

export const SIEMBRAS = ['POSICIONES', 'ALEATORIA', 'MANUAL'] as const;
export type Siembra = (typeof SIEMBRAS)[number];

const llaveSchema = z.object({
  equipoLocalId: z.string().min(1),
  equipoVisitanteId: z.string().min(1),
});

/**
 * `siembra` cae en POSICIONES cuando no viene: es lo que hacía la app antes de que existieran
 * las otras, así que un cliente viejo sigue generando el mismo cuadro.
 */
export const generateSchema = z.object({
  divisionId: z.string().min(1),
  cantidadEquipos: z.number().int().refine((n) => [2, 4, 8, 16, 32].includes(n), {
    message: 'Debe ser 2, 4, 8, 16 o 32',
  }),
  siembra: z.enum(SIEMBRAS).default('POSICIONES'),
  llaves: z.array(llaveSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.siembra === 'MANUAL') {
    if (!value.llaves) {
      ctx.addIssue({ code: 'custom', message: 'La siembra manual necesita las llaves', path: ['llaves'] });
      return;
    }
    const esperadas = value.cantidadEquipos / 2;
    if (value.llaves.length !== esperadas) {
      ctx.addIssue({
        code: 'custom',
        message: `Se esperaban ${esperadas} llaves para ${value.cantidadEquipos} equipos, llegaron ${value.llaves.length}`,
        path: ['llaves'],
      });
    }
    return;
  }
  // Aceptar llaves que la estrategia va a ignorar haría creer que el cruce enviado se respetó.
  if (value.llaves) {
    ctx.addIssue({ code: 'custom', message: 'Solo la siembra manual acepta llaves', path: ['llaves'] });
  }
});

export type GenerateInput = z.output<typeof generateSchema>;
export type CreateInput = z.output<typeof createSchema>;
export type UpdateInput = z.output<typeof updateSchema>;
