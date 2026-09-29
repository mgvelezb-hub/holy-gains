import { NextResponse } from "next/server";
import { parseElecciones } from "engine";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { baseLicuadoDe, sinMarcaDeLeche, tipoLecheDe } from "@/lib/coachy/leche";
import { parsePantry } from "@/lib/coachy/mapping";
import { preferenciaDePreparaciones } from "@/lib/coachy/preparaciones";
import { decimalToNumber } from "@/lib/format";
import { parseDisciplineLoads, parseTimePerDay, parseUnilateralMode } from "@/lib/training/db";
import { normalizeCustomSplit } from "@/lib/training/split";

/**
 * `GET /api/v1/me` — quién es el atleta autenticado y si ya terminó el
 * onboarding. Es lo primero que la app nativa pregunta al abrir sesión.
 *
 * Solo campos básicos del perfil: nada de `healthIngestToken` (es una
 * credencial) ni del ciclo menstrual (dato sensible, opt-in de la atleta).
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const profile = user.profile;

  return NextResponse.json({
    user: { id: user.id, email: user.email, role: user.role },
    onboarded: Boolean(profile?.onboardingCompletedAt),
    profile: profile
      ? {
          displayName: profile.displayName,
          // La app lo usa para no preguntarle del ciclo a quien no aplica.
          sex: profile.sex,
          heightCm: decimalToNumber(profile.heightCm),
          currentPhase: profile.currentPhase,
          goal: profile.goal,
          // No hay campo `trainingDaysPerWeek` en el schema; `liftingDays` es
          // su equivalente (días de pesas por semana, spec 03 §5).
          trainingDaysPerWeek: profile.liftingDays,
          // Cuándo cierra su semana. La app programa el recordatorio local
          // con esto; `null` = todavía no lo eligió.
          checkinWeekday: profile.checkinWeekday,
          checkinHour: profile.checkinHour,
          // Lo que la pantalla de Nutrición necesita para explicar el plan.
          budget: profile.budget,
          mealsPerDay: profile.mealsPerDay,
          // Preferencias que mandan sobre la planeación (Fase 6). Van aquí
          // porque la pantalla de Ajustes las pinta prellenadas: sin esto
          // habría que adivinar qué eligió la persona la última vez.
          maxPrepMin: profile.maxPrepMin,
          favoriteFoods: profile.favoriteFoods,
          // Lo que ya tiene comprado. La pantalla de la despensa lo pinta
          // marcado y el renglón de Ajustes cuenta cuántos alimentos son.
          pantry: parsePantry(profile.pantry),
          // Sin la marca de leche: la pantalla de excluidos no la pinta, y
          // PATCH /me/nutricion la conserva aunque no regrese.
          excludedFoods: sinMarcaDeLeche(profile.excludedFoods),
          // La leche de licuados y cremas (`lib/coachy/leche.ts`).
          tipoLeche: tipoLecheDe(profile.excludedFoods),
          // Con qué se licua: leche (la de arriba) o agua.
          baseLicuado: baseLicuadoDe(profile.excludedFoods),
          // Licuados, sopas y cremas: se leen de los excluidos (ver
          // `lib/coachy/preparaciones.ts`); Ajustes pinta los interruptores.
          preparaciones: preferenciaDePreparaciones(profile.excludedFoods),
          avoidRepeatGroups: profile.avoidRepeatGroups,
          primaryDiscipline: profile.primaryDiscipline,
          otherDisciplines: parseDisciplineLoads(profile.otherDisciplines),
          swimLevel: profile.swimLevel,
          disciplineLevels: profile.disciplineLevels,
          // Minutos por día que la persona declaró al replanificar. `null` =
          // no se ha declarado: la pantalla de recalibrar no tiene por qué
          // adivinar contando sesiones si esto ya viene aquí.
          timePerDay: parseTimePerDay(profile.timePerDay),
          // Si el planificador combina disciplinas compatibles el mismo día
          // (Fase 10). Ajustes lo pinta prellenado con lo que ya eligió.
          compactDays: profile.compactDays,
          // Estilo de esquema fijo, o `RECOMENDADO` si dejó la rotación
          // decidiendo. Ajustes lo pinta prellenado, igual que `compactDays`.
          schemePreference: profile.schemePreference,
          // El split que fijó a mano, día por día (Fase 3). `null` = lo
          // decide el motor. `unilateralMode` viaja dentro del mismo JSON —
          // ver `parseUnilateralMode` en `training/db.ts` para el porqué.
          customSplit: normalizeCustomSplit(profile.customSplit),
          unilateralMode: parseUnilateralMode(profile.customSplit),
          trainingSchedule: profile.trainingSchedule,
          dietStyle: profile.dietStyle,
          supplements: profile.supplements,
          // Qué sugerencias aceptó o descartó, y si quiere tés e infusiones.
          // El renglón de Ajustes cuenta tomas y sugerencias con esto.
          supplementChoices: parseElecciones(profile.supplementChoices),
          // A qué hora entrena: la pantalla de dieta lo necesita para avisar
          // cuando la ventana del ayuno deja el entrenamiento fuera.
          trainingTime: profile.trainingTime,
          // Cómo acomodó su Resumen. El servidor lo guarda tal cual; el
          // catálogo de paneles vive en la app.
          summaryLayout: profile.summaryLayout,
          goalReference: profile.goalReference,
          fastingStartHour: profile.fastingStartHour,
          fastingEndHour: profile.fastingEndHour,
        }
      : null,
  });
}
