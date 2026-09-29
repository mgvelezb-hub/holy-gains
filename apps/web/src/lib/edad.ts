/**
 * Años cumplidos a partir de lo que trae el perfil: la fecha de nacimiento
 * o, si solo declaró un rango ("35_44"), su punto medio. Sin nada, `null`.
 *
 * La usan la FC máxima del descanso por pulso (`/me/ejercicio-prefs`) y las
 * zonas de pulso de cada tramo de cardio (P1: 208 − 0.7 × edad).
 */
export function edadEnAnios(
  birthDate: Date | null,
  ageRange: string | null,
  hoy: Date = new Date(),
): number | null {
  if (birthDate) {
    let anios = hoy.getUTCFullYear() - birthDate.getUTCFullYear();
    const mes = hoy.getUTCMonth() - birthDate.getUTCMonth();
    if (mes < 0 || (mes === 0 && hoy.getUTCDate() < birthDate.getUTCDate())) anios -= 1;
    return anios > 0 ? anios : null;
  }
  const rango = /^(\d{2})_(\d{2})$/.exec(ageRange ?? "");
  if (rango) return Math.round((Number(rango[1]) + Number(rango[2]) + 1) / 2);
  return null;
}
