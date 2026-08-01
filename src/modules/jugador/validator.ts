import { z } from 'zod';

export const posicionJugadorSchema = z.enum(['PORTERO', 'DEFENSA', 'LATERAL', 'CONTENCION', 'MEDIO', 'EXTREMO', 'DELANTERO']);

export const createJugadorSchema = z.object({
  nombre: z.string().min(1),
  posicion: posicionJugadorSchema,
  foto: z.string().optional(),
  fotoPublicId: z.string().optional(),
  edad: z.number().int().min(0).max(120).optional(),
  telefono: z.string().min(8),
  equipoId: z.string().min(1),
  dorsal: z.number().int().min(0).max(999),
});

export const updateJugadorSchema = z.object({
  nombre: z.string().min(1).optional(),
  posicion: posicionJugadorSchema.optional(),
  foto: z.string().nullable().optional(),
  fotoPublicId: z.string().nullable().optional(),
  edad: z.number().int().min(0).max(120).nullable().optional(),
  telefono: z.string().nullable().optional(),
  dorsal: z.number().int().min(0).max(999).optional(),
  equipoId: z.string().min(1).optional(),
});

export const assignJugadorSchema = z.object({
  equipoId: z.string().min(1),
  jugadorId: z.string().min(1),
  dorsal: z.number().int().min(0).max(999),
});

export const createMeSchema = z.object({
  nombre: z.string().min(1),
  posicion: posicionJugadorSchema,
  foto: z.string().optional(),
  fotoPublicId: z.string().optional(),
  edad: z.number().int().min(0).max(120).optional(),
});

export const updateMeSchema = z.object({
  nombre: z.string().min(1).optional(),
  posicion: posicionJugadorSchema.optional(),
  foto: z.string().nullable().optional(),
  fotoPublicId: z.string().nullable().optional(),
  edad: z.number().int().min(0).max(120).nullable().optional(),
  showPhoneInPublicProfile: z.boolean().optional(),
});

export const divisionJugadorSchema = z.object({
  divisionId: z.string().min(1),
  equipoId: z.string().min(1),
  jugadorId: z.string().min(1),
});
