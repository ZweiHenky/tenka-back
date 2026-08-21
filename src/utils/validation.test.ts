import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { firstIssueMessage } from './validation';

function errorFor(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('se esperaba un fallo de validación');
  return result.error;
}

describe('firstIssueMessage', () => {
  it('antepone el campo en un error de tipo', () => {
    const schema = z.object({ diasPartido: z.string() });
    // Sin el prefijo, el mensaje de zod no dice cuál de los campos falló.
    expect(firstIssueMessage(errorFor(schema, {})))
      .toBe('diasPartido: Invalid input: expected string, received undefined');
  });

  it('antepone el campo en una cadena demasiado corta', () => {
    const schema = z.object({ nombre: z.string().min(1) });
    expect(firstIssueMessage(errorFor(schema, { nombre: '' }))).toMatch(/^nombre: /);
  });

  it('usa la ruta completa en campos anidados', () => {
    const schema = z.object({ horarios: z.array(z.object({ canchaId: z.string() })) });
    expect(firstIssueMessage(errorFor(schema, { horarios: [{}] }))).toMatch(/^horarios\.0\.canchaId: /);
  });

  it('deja intacto un mensaje propio, que ya se lee como frase', () => {
    const schema = z.object({ a: z.string() }).superRefine((_data, ctx) => {
      ctx.addIssue({ code: 'custom', message: 'Configura días y horario de partido', path: ['horarioPartido'] });
    });
    expect(firstIssueMessage(errorFor(schema, { a: 'x' }))).toBe('Configura días y horario de partido');
  });

  it('no antepone nada cuando el error es de la raíz', () => {
    const schema = z.string();
    expect(firstIssueMessage(errorFor(schema, 1))).not.toMatch(/^: /);
  });
});
