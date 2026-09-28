import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState, LoadingState } from "@/components/States";
import { SeccionHorariosComida } from "@/components/ajustes/SeccionHorariosComida";
import { HorarioDeEntrenamiento } from "@/components/ajustes/HorarioDeEntrenamiento";
import { EditorCierreSemana } from "@/components/ajustes/detalle/EditorCierreSemana";
import {
  DetalleSemana,
  EditorAgregarEjercicio,
  EditorArmadoSemana,
  EditorDisciplina,
  EditorDisciplinasBase,
  EditorEjercicios,
  EditorEjerciciosDia,
  EditorEsquema,
  EditorGrupos,
  EditorSplit,
  EditorTiempoPorDia,
  EditorUnilateral,
  disciplinaNombre,
} from "@/components/ajustes/detalle/EditoresEntrenamiento";
import {
  EditorAlacena,
  EditorCocina,
  EditorDieta,
  EditorGustos,
  EditorPreparaciones,
  EditorPresupuesto,
} from "@/components/ajustes/detalle/EditoresNutricion";
import { EditorLeche } from "@/components/ajustes/detalle/EditorLeche";
import { useTheme } from "@/context/theme";
import { ApiError, getMe, type Discipline, type MeResponse } from "@/lib/api";
import { DISCIPLINAS } from "@/lib/entrenamiento";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * La hoja de zoom de Ajustes: `/ajustes/detalle/<tema>`.
 *
 * La ley de diseño de la app es que NADA se abre hacia abajo — cada sección
 * es una lista de renglones con el estado actual, y el editor completo vive
 * aquí, en su propia hoja con back. Todos los temas comparten este archivo
 * por la misma razón que las secciones comparten `[seccion].tsx`: casi todos
 * los editores se prellenan de `GET /me`, y una hoja por archivo repetiría
 * esa carga y este mismo esqueleto catorce veces. Lo que cambia por tema es
 * únicamente qué editor se pinta.
 */

const TITULOS: Record<string, string> = {
  cierre: "Cierre de semana",
  horario: "A qué hora entrenas",
  semana: "Tu semana",
  armado: "Cómo se arma tu semana",
  esquema: "Cómo te gusta entrenar",
  split: "Tu split",
  ejercicios: "Ejercicios",
  bases: "Disciplinas base",
  unilaterales: "Unilaterales",
  disciplina: "Disciplina",
  tiempo: "Tiempo por día",
  grupos: "Grupos que no repites",
  "horarios-comida": "A qué hora comes",
  dieta: "Tu tipo de dieta",
  presupuesto: "Presupuesto de despensa",
  cocina: "Cuánto quieres cocinar",
  alacena: "Suplementos",
  gustos: "Lo que sí y lo que no",
  preparaciones: "Licuados, sopas y cremas",
};

/** Temas que se pintan sin esperar `/me` (cargan lo suyo por su cuenta). */
const SIN_ME = new Set(["semana", "horarios-comida", "ejercicios"]);

export default function AjustesDetalleScreen() {
  const { tema, d, k, agregar } = useLocalSearchParams<{
    tema: string;
    d?: string;
    /** Tipo de día de la hoja de ejercicios: `?k=PECHO_TRICEP`. */
    k?: string;
    /** `?agregar=1` abre el catálogo en vez del editor del día. */
    agregar?: string;
  }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const necesitaMe = !SIN_ME.has(tema ?? "");

  const loadMe = useCallback(async () => {
    setMeError(null);
    try {
      setMe(await getMe());
    } catch (error) {
      setMeError(error instanceof ApiError ? error.message : "No se pudo cargar tu perfil");
    }
  }, []);

  useEffect(() => {
    if (necesitaMe) void loadMe();
  }, [necesitaMe, loadMe]);

  // El `?d=` de la hoja de disciplina, validado contra el catálogo: un valor
  // inventado en la URL no debe pintar un editor a medias.
  const disciplina = DISCIPLINAS.find((entrada) => entrada.valor === d)?.valor as
    | Discipline
    | undefined;

  const titulo =
    tema === "disciplina" && disciplina ? disciplinaNombre(disciplina) : TITULOS[tema ?? ""] ?? "Ajustes";

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.backText}>Atrás</Text>
          </Pressable>

          <Text style={styles.title}>{titulo}</Text>

          {tema === "semana" && <DetalleSemana />}
          {/* Tres hojas en un tema: la lista de días, el editor de un día y el
              catálogo para agregar. Cada zoom abre hoja nueva, nunca se
              despliega hacia abajo. */}
          {tema === "ejercicios" && !k && <EditorEjercicios />}
          {tema === "ejercicios" && k && agregar !== "1" && <EditorEjerciciosDia dayKind={k} />}
          {tema === "ejercicios" && k && agregar === "1" && <EditorAgregarEjercicio dayKind={k} />}
          {tema === "horarios-comida" && <SeccionHorariosComida />}

          {necesitaMe && !me && !meError && <LoadingState label="Cargando tus ajustes..." />}
          {necesitaMe && !me && meError && <ErrorState message={meError} onRetry={loadMe} />}

          {me && tema === "cierre" && <EditorCierreSemana me={me} />}
          {me && tema === "horario" && <HorarioDeEntrenamiento me={me} />}
          {me && tema === "armado" && <EditorArmadoSemana me={me} />}
          {me && tema === "esquema" && <EditorEsquema me={me} />}
          {me && tema === "split" && <EditorSplit me={me} />}
          {me && tema === "bases" && <EditorDisciplinasBase me={me} />}
          {me && tema === "unilaterales" && <EditorUnilateral me={me} />}
          {me && tema === "disciplina" && disciplina && (
            <EditorDisciplina me={me} discipline={disciplina} />
          )}
          {me && tema === "tiempo" && <EditorTiempoPorDia me={me} />}
          {me && tema === "grupos" && <EditorGrupos me={me} />}
          {me && tema === "dieta" && <EditorDieta me={me} />}
          {me && tema === "presupuesto" && <EditorPresupuesto me={me} />}
          {me && tema === "cocina" && <EditorCocina me={me} />}
          {me && tema === "alacena" && <EditorAlacena me={me} />}
          {me && tema === "gustos" && <EditorGustos me={me} />}
          {me && tema === "preparaciones" && <EditorPreparaciones me={me} />}
          {me && tema === "preparaciones" && <EditorLeche me={me} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    flex: { flex: 1 },
    content: {
      padding: spacing.lg,
      gap: spacing.lg,
      // Aire extra al fondo: la hoja de gustos termina en campos de texto y
      // el teclado no debe taparlos.
      paddingBottom: spacing.huge * 2,
    },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
  });
