export interface PlayoffFinalizationSchedule {
  fecha: Date | string | null
  fechaFin: Date | string | null
  multiplesCanchas: boolean
  canchaId: string | null
}

export function validatePlayoffFinalizationSchedule(schedule: PlayoffFinalizationSchedule): string | null {
  if (!schedule.fecha || !schedule.fechaFin) {
    return 'Para asignar resultados, primero genera la jornada.'
  }

  const fecha = schedule.fecha instanceof Date ? schedule.fecha : new Date(schedule.fecha)
  const fechaFin = schedule.fechaFin instanceof Date ? schedule.fechaFin : new Date(schedule.fechaFin)
  if (!Number.isFinite(fecha.getTime()) || !Number.isFinite(fechaFin.getTime()) || fechaFin <= fecha) {
    return 'Para asignar resultados, primero genera la jornada.'
  }

  if (schedule.multiplesCanchas && !schedule.canchaId) {
    return 'No se puede finalizar un partido de eliminatoria sin cancha en una liga con múltiples canchas'
  }

  return null
}
