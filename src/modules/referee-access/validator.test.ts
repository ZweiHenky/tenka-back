import { describe, expect, it } from 'vitest'
import { refereeResultSchema } from './validator'
import { resultSchema } from '../partido/validator'

const base = {
  expectedVersion: 1,
  golesLocal: 2,
  golesVisitante: 1,
  estado: 'FINALIZADO' as const,
  allocations: [],
}

describe('el árbitro no puede saltarse el mínimo de eliminatorias', () => {
  /**
   * La excepción vive en el input, no en un permiso aparte, y esto es lo que la hace segura: los
   * dos esquemas son `.strict()`, así que un campo no declarado **se rechaza**. El validador del
   * árbitro no declara `permitirInelegibles`, y su ruta se autentica por token sin pasar por
   * `assertOwnerOrAdmin`.
   *
   * Si alguien agregara el campo aquí "por simetría", este test lo detiene.
   */
  it('rechaza la petición si trae permitirInelegibles', () => {
    const parsed = refereeResultSchema.safeParse({ ...base, permitirInelegibles: true })
    expect(parsed.success).toBe(false)
  })

  it('la misma bandera sí se acepta en la ruta autenticada del dueño', () => {
    const parsed = resultSchema.safeParse({ ...base, permitirInelegibles: true })
    expect(parsed.success).toBe(true)
  })

  it('sin la bandera, la captura del árbitro sigue funcionando', () => {
    expect(refereeResultSchema.safeParse(base).success).toBe(true)
  })
})
