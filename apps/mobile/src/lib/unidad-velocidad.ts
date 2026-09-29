import { getMe, patchEntrenamiento, type UnidadVelocidad } from "@/lib/api";
import { conUnidadVelocidad } from "@/lib/hiit";

/**
 * Guarda km/h ↔ mph (N1) dentro de las preferencias de CARDIO de
 * `otherDisciplines`. Se relee el perfil antes de escribir porque el PATCH
 * manda la lista COMPLETA: escribir sobre una copia vieja borraría lo que
 * Ajustes haya cambiado mientras tanto.
 */
export async function guardarUnidadVelocidad(unidad: UnidadVelocidad): Promise<void> {
  const me = await getMe();
  const otras = me.profile?.otherDisciplines ?? [];
  if (!otras.some((carga) => carga.discipline === "CARDIO")) return;
  await patchEntrenamiento({ otherDisciplines: conUnidadVelocidad(otras, unidad) });
}
