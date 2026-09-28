import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, ChevronLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { AnalizandoCheckin } from "@/components/AnalizandoCheckin";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { Parrafo } from "@/components/Parrafo";
import { PercentStepper } from "@/components/PercentStepper";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Slider15 } from "@/components/Slider15";
import { Stepper } from "@/components/Stepper";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getMe,
  getActivities,
  getComidasLog,
  getDecision,
  getHistoryMeasurements,
  getTrainingWeek,
  PHOTO_BUCKET,
  PHOTO_VIEWS,
  PHOTO_VIEW_LABEL,
  postCheckin,
  postCheckinListo,
  postCheckinPhoto,
  progressPhotoPath,
  SYMPTOMS,
  SYMPTOM_LABELS,
  type PhotoView,
  type Symptom,
} from "@/lib/api";
import { useSession } from "@/context/session";
import { alEnviar, tocaMensual, type AvisoAnalisis } from "@/lib/analisis-checkin";
import { aplicarAccionAviso, estadoPermisoNotificaciones, pedirPermisoNotificaciones } from "@/lib/recordatorio";
import { supabase } from "@/lib/supabase";
import { fonts, radius, spacing, type Palette, type as typeScale } from "@/lib/theme";

/** yyyy-MM-dd de hoy, en hora local (no UTC: evita cruzar de día cerca de medianoche). */
function todayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "12,5" o "12.5" → 12.5. Vacío → null. */
function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

export default function CheckinScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /** El check-in ya se envió: su id, para sondear el análisis. */
  const [enviado, setEnviado] = useState<{
    id: string;
    aviso: AvisoAnalisis;
    /** `listo` no llegó al servidor: la pantalla de análisis lo reintenta. */
    listoPendiente: boolean;
    conFotos: boolean;
    esMensual: boolean;
  } | null>(null);
  /**
   * Fotos opcionales, una por vista. Se eligen antes de enviar y se suben
   * DESPUÉS, cuando el check-in ya existe: la ruta en Storage lleva su id, así
   * que antes de crearlo no hay dónde ponerlas.
   */
  const [fotos, setFotos] = useState<Partial<Record<PhotoView, string>>>({});
  const [fotosError, setFotosError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Medidas
  const [waistCm, setWaistCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [legLeftCm, setLegLeftCm] = useState("");
  const [legRightCm, setLegRightCm] = useState("");
  const [armLeftCm, setArmLeftCm] = useState("");
  const [armRightCm, setArmRightCm] = useState("");

  // Sensaciones
  const [inflammation, setInflammation] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [hunger, setHunger] = useState<number | null>(null);
  const [satiety, setSatiety] = useState<number | null>(null);
  const [strengthRpe, setStrengthRpe] = useState("");

  // Cumplimiento
  const [dietCompliance, setDietCompliance] = useState(80);
  const [trainingCompliance, setTrainingCompliance] = useState(80);
  /**
   * Brazos y piernas cambian demasiado lento para leerse cada 7 días, así que
   * dejan de ser campos semanales: se abren a mano, o solos cuando ya pasó un
   * mes desde la última vez que se midieron.
   */
  /**
   * Brazos y piernas van una vez al mes, y la app sabe cuándo fue la última:
   * cuando toca, la sección se abre sola y lo dice. Dejar la cadencia solo en
   * la copia obliga a la persona a llevar la cuenta, que es justo lo que la
   * app puede hacer por ella.
   */
  const [mostrarMensuales, setMostrarMensuales] = useState(false);
  /** Ya pasó un mes desde brazos/piernas: este check-in es el mensual. */
  const [esMesDeMedidas, setTocaMensual] = useState(false);
  const [ultimaMensual, setUltimaMensual] = useState<string | null>(null);
  /** El renglón que explica el diálogo de permiso mientras está en pantalla. */
  const [pidiendoPermiso, setPidiendoPermiso] = useState(false);

  useEffect(() => {
    // El permiso se pide al ABRIR el check-in, no al final: al enviarlo la
    // persona ya va de salida, y con la app yéndose iOS no muestra el diálogo.
    let vivo = true;
    void (async () => {
      if ((await estadoPermisoNotificaciones()) !== "sin-preguntar") return;
      if (vivo) setPidiendoPermiso(true);
      await pedirPermisoNotificaciones();
      if (vivo) setPidiendoPermiso(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    // El contador del servidor manda (`tocaMensual`); el historial local solo
    // pone la fecha del enlace y sirve de respaldo si no hay señal.
    Promise.all([
      getDecision()
        .then((respuesta) => ({ proximoMensual: respuesta.proximoMensual }))
        .catch(() => null),
      getHistoryMeasurements().catch(() => null),
    ]).then(([servidor, historial]) => {
      if (!vivo) return;

      const ultima =
        [...(historial?.points ?? [])]
          .filter((punto) => punto.armLeftCm !== null || punto.legLeftCm !== null)
          .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
      setUltimaMensual(ultima);

      const diasDesdeUltimaLocal =
        historial === null
          ? null
          : ultima === null
            ? Infinity
            : Math.round(
                (Date.parse(`${todayISO()}T12:00:00.000Z`) - Date.parse(`${ultima}T12:00:00.000Z`)) /
                  86_400_000,
              );

      if (tocaMensual({ servidor, diasDesdeUltimaLocal })) {
        setMostrarMensuales(true);
        setTocaMensual(true);
      }
    });
    return () => {
      vivo = false;
    };
  }, []);
  const [symptoms, setSymptoms] = useState<Set<Symptom>>(new Set());
  const [comment, setComment] = useState("");
  const [periodStarted, setPeriodStarted] = useState(false);

  // El ciclo no se le pregunta a quien no le aplica. Si el perfil no cargó,
  // se asume que NO aplica: preguntar de más es peor que preguntar de menos.
  const [sex, setSex] = useState<"FEMALE" | "MALE" | "OTHER" | null>(null);
  useEffect(() => {
    let vivo = true;
    getMe()
      .then((me) => {
        if (vivo) setSex(me.profile?.sex ?? null);
      })
      .catch(() => {
        // Sin perfil el formulario sigue siendo usable; solo no muestra ciclo.
      });
    return () => {
      vivo = false;
    };
  }, []);
  const preguntaCiclo = sex === "FEMALE" || sex === "OTHER";

  /**
   * El cumplimiento de entrenamiento llega prellenado con lo que la app ya
   * sabe: cuántas sesiones de la semana quedaron cerradas. Se puede corregir
   * —quien entrenó fuera de la app lo sube— pero preguntar desde cero algo que
   * está registrado serie por serie es pedirle a la memoria lo que ya está
   * medido.
   */
  /**
   * El apego a la dieta ya no se pregunta desde cero: sale de las comidas que
   * se confirmaron durante la semana. Se puede corregir —quien comió fuera y
   * no lo marcó lo ajusta— pero el punto de partida es lo medido.
   */
  const [dietaAuto, setDietaAuto] = useState<{ apego: number; contestadas: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    getComidasLog()
      .then((respuesta) => {
        if (!vivo || respuesta.apego === null) return;
        setDietaAuto({ apego: respuesta.apego, contestadas: respuesta.contestadas });
        setDietCompliance(respuesta.apego);
      })
      .catch(() => {
        // Sin comidas confirmadas se pregunta como siempre.
      });
    return () => {
      vivo = false;
    };
  }, []);

  const [entrenoAuto, setEntrenoAuto] = useState<{ hechas: number; total: number } | null>(null);
  useEffect(() => {
    let vivo = true;
    Promise.all([getTrainingWeek(), getActivities().catch(() => null)])
      .then(([week, actividades]) => {
        if (!vivo) return;

        // La semana no son solo las pesas: desde la Fase 7 hay sesiones de
        // otras disciplinas, y contarlas fuera castigaría a quien sí entrenó.
        // Una sesión de otra disciplina cuenta como hecha si ese día quedó
        // registrada una actividad.
        const otras = week.otherSessions ?? [];
        const registradas = new Set((actividades?.actividades ?? []).map((entrada) => entrada.date));

        const total = week.sessions.length + otras.length;
        if (total === 0) return;

        const hechas =
          week.sessions.filter((sesion) => sesion.completedAt !== null).length +
          otras.filter((sesion) => registradas.has(sesion.date)).length;

        setEntrenoAuto({ hechas, total });
        setTrainingCompliance(Math.round((hechas / total) * 100));
      })
      .catch(() => {
        // Sin semana cargada se queda el valor por defecto y se pregunta normal.
      });
    return () => {
      vivo = false;
    };
  }, []);

  function toggleSymptom(symptom: Symptom) {
    setSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(symptom)) next.delete(symptom);
      else next.add(symptom);
      return next;
    });
  }

  async function elegirFoto(view: PhotoView) {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      setFotosError("Necesitas dar acceso a tus fotos para adjuntarlas.");
      return;
    }

    const elegida = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (elegida.canceled || elegida.assets.length === 0) return;

    setFotosError(null);
    setFotos((actuales) => ({ ...actuales, [view]: elegida.assets[0]!.uri }));
  }

  /**
   * Sube al bucket con la sesión del propio atleta —la RLS filtra por primera
   * carpeta = su id— y después le avisa al servidor para que cree la fila. Una
   * foto que falle no tumba el check-in: ya quedó guardado, y las fotos son
   * opcionales.
   */
  async function subirFotos(checkInId: string, userId: string) {
    for (const view of PHOTO_VIEWS) {
      const uri = fotos[view];
      if (!uri) continue;

      try {
        const archivo = await fetch(uri).then((response) => response.arrayBuffer());
        const { error } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(progressPhotoPath(userId, checkInId, view), archivo, {
            upsert: true,
            contentType: "image/jpeg",
          });
        if (error) throw error;

        await postCheckinPhoto(checkInId, view);
      } catch {
        setFotosError("Alguna foto no se pudo subir. Tu check-in sí quedó guardado.");
      }
    }
  }

  async function handleSubmit() {
    setGeneralError(null);
    setFieldErrors({});

    if (!waistCm.trim()) {
      setFieldErrors({ waistCm: "La cintura es obligatoria" });
      return;
    }
    if (inflammation === null || energy === null || hunger === null || satiety === null) {
      setGeneralError("Completa las 5 escalas de sensaciones antes de enviar");
      return;
    }

    setSubmitting(true);
    const hayFotos = Object.values(fotos).some(Boolean);
    try {
      const creado = await postCheckin({
        ...(hayFotos ? { fotosPendientes: true } : {}),
        date: todayISO(),
        waistCm: parseDecimal(waistCm) ?? 0,
        weightKg: parseDecimal(weightKg),
        legLeftCm: parseDecimal(legLeftCm),
        legRightCm: parseDecimal(legRightCm),
        armLeftCm: parseDecimal(armLeftCm),
        armRightCm: parseDecimal(armRightCm),
        inflammation,
        energy,
        hunger,
        satiety,
        strengthRpe: strengthRpe.trim() ? Math.round(Number(strengthRpe)) : null,
        dietCompliance,
        trainingCompliance,
        symptoms: [...symptoms],
        comment: comment.trim() || undefined,
        periodStarted,
      });

      // El aviso de "tu retro está lista" se programa YA, con la app en primer
      // plano: dejarlo para cuando se vaya a segundo plano es una carrera que
      // iOS puede cortar suspendiéndola antes de que termine.
      const inicioAviso = alEnviar(Date.now());
      const avisoProgramado = aplicarAccionAviso(inicioAviso.accion);

      // Con fotos, el servidor espera a `listo` para analizar con ellas. Si la
      // subida falla se avisa igual: mejor análisis sin fotos que sin decisión.
      let listoPendiente = false;
      if (hayFotos) {
        const userId = session?.user.id ?? null;
        if (userId) await subirFotos(creado.id, userId);
        listoPendiente = await postCheckinListo(creado.id).then(
          () => false,
          () => true,
        );
      }

      const trajoMensuales = [legLeftCm, legRightCm, armLeftCm, armRightCm].some((v) => v.trim() !== "");
      await avisoProgramado;
      setEnviado({
        id: creado.id,
        aviso: inicioAviso.aviso,
        listoPendiente,
        conFotos: hayFotos,
        esMensual: trajoMensuales || esMesDeMedidas,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.detalles) {
        setFieldErrors(error.detalles);
        // Si el servidor rechazó un campo que esta pantalla no pinta, decir
        // "revisa los campos marcados" con todo lleno es un callejón sin
        // salida. Se nombra el campo y su motivo para que se vea dónde está.
        const visibles = new Set([
          "waistCm", "weightKg", "legLeftCm", "legRightCm", "armLeftCm", "armRightCm",
          "inflammation", "energy", "hunger", "satiety", "strengthRpe",
        ]);
        const ocultos = Object.entries(error.detalles).filter(([campo]) => !visibles.has(campo));
        setGeneralError(
          ocultos.length === 0
            ? "Revisa los campos marcados"
            : `No se pudo enviar: ${ocultos.map(([campo, motivo]) => `${campo} (${motivo})`).join(", ")}`,
        );
      } else if (error instanceof ApiError && error.status === 403) {
        setGeneralError("Termina tu onboarding antes de enviar un check-in");
      } else {
        setGeneralError(
          error instanceof ApiError ? error.message : "No se pudo enviar. Intenta de nuevo",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (enviado) {
    return (
      <AnalizandoCheckin
        checkInId={enviado.id}
        aviso={enviado.aviso}
        listoPendiente={enviado.listoPendiente}
        conFotos={enviado.conFotos}
        esMensual={enviado.esMensual}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backRow}>
        <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
        <Text style={styles.backText}>Atrás</Text>
      </Pressable>

      <Text style={styles.title}>Check-in semanal</Text>
      {pidiendoPermiso ? <Text style={styles.autoNota}>Te aviso cuando tu retroalimentación esté lista</Text> : null}

      <Card>
        <SectionLabel>Medidas</SectionLabel>
        <View style={styles.fieldGroup}>
          <Stepper
            label="Cintura"
            unit="cm"
            required
            value={waistCm}
            onChangeText={setWaistCm}
            error={fieldErrors.waistCm}
          />
          <Stepper
            label="Peso"
            unit="kg"
            value={weightKg}
            onChangeText={setWeightKg}
            error={fieldErrors.weightKg}
          />
          {mostrarMensuales ? (
            <>
              <View style={styles.row}>
                <View style={styles.half}>
                  <Stepper
                    label="Pierna izq."
                    unit="cm"
                    value={legLeftCm}
                    onChangeText={setLegLeftCm}
                    error={fieldErrors.legLeftCm}
                  />
                </View>
                <View style={styles.half}>
                  <Stepper
                    label="Pierna der."
                    unit="cm"
                    value={legRightCm}
                    onChangeText={setLegRightCm}
                    error={fieldErrors.legRightCm}
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.half}>
                  <Stepper
                    label="Brazo izq."
                    unit="cm"
                    value={armLeftCm}
                    onChangeText={setArmLeftCm}
                    error={fieldErrors.armLeftCm}
                  />
                </View>
                <View style={styles.half}>
                  <Stepper
                    label="Brazo der."
                    unit="cm"
                    value={armRightCm}
                    onChangeText={setArmRightCm}
                    error={fieldErrors.armRightCm}
                  />
                </View>
              </View>
            </>
          ) : (
            <Pressable onPress={() => setMostrarMensuales(true)} hitSlop={8}>
              <Text style={styles.mensualesLink}>
                {ultimaMensual
                  ? `Agregar brazos y piernas · las últimas fueron el ${ultimaMensual.slice(8)}/${ultimaMensual.slice(5, 7)} →`
                  : "Agregar brazos y piernas (van una vez al mes) →"}
              </Text>
            </Pressable>
          )}
        </View>
      </Card>

      <Card>
        <SectionLabel>Sensaciones</SectionLabel>
        <View style={styles.fieldGroup}>
          <ScaleField label="Inflamación" value={inflammation} onChange={setInflammation} error={fieldErrors.inflammation} />
          <ScaleField label="Energía" value={energy} onChange={setEnergy} error={fieldErrors.energy} />
          <ScaleField label="Hambre" value={hunger} onChange={setHunger} error={fieldErrors.hunger} />
          <ScaleField label="Saciedad" value={satiety} onChange={setSatiety} error={fieldErrors.satiety} />
          <Stepper
            label="Qué tan pesado se sintió"
            unit="/ 10"
            keyboardType="number-pad"
            value={strengthRpe}
            onChangeText={setStrengthRpe}
            error={fieldErrors.strengthRpe}
          />
          <Parrafo style={styles.rpeHint}>
            Del 1 al 10, qué tan exigente sentiste tu entrenamiento esta semana: 1 es
            &quot;me sobró&quot; y 10 es &quot;no podía con una más&quot;. Si no estás
            seguro, déjalo vacío.
          </Parrafo>
        </View>
      </Card>

      <Card>
        <SectionLabel>Cumplimiento</SectionLabel>
        <View style={styles.fieldGroup}>
          <PercentStepper label="Dieta" value={dietCompliance} onChange={setDietCompliance} />
          {dietaAuto && (
            <Parrafo style={styles.autoNota}>
              Prellenado con tus comidas confirmadas: {dietaAuto.contestadas}{" "}
              {dietaAuto.contestadas === 1 ? "respondida" : "respondidas"} estos días.
            </Parrafo>
          )}
          <PercentStepper label="Entreno" value={trainingCompliance} onChange={setTrainingCompliance} />
          {entrenoAuto && (
            <Parrafo style={styles.autoNota}>
              Prellenado con lo que ya entrenaste: {entrenoAuto.hechas} de {entrenoAuto.total}{" "}
              sesiones de tu semana, gimnasio y otras disciplinas.
              Corrígelo si entrenaste fuera de la app.
            </Parrafo>
          )}
        </View>
      </Card>

      <Card>
        <SectionLabel>Síntomas</SectionLabel>
        <View style={styles.chipsRow}>
          {SYMPTOMS.map((symptom) => (
            <Chip
              key={symptom}
              label={SYMPTOM_LABELS[symptom]}
              selected={symptoms.has(symptom)}
              onPress={() => toggleSymptom(symptom)}
            />
          ))}
        </View>

        <View style={styles.commentField}>
          <Text style={styles.commentLabel}>COMENTARIO</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Cómo te sentiste esta semana..."
            placeholderTextColor={colors.paloRosaLight}
            multiline
            style={styles.commentInput}
          />
          <Parrafo style={styles.commentHint}>
            Las fotos del check-in llegan en una fase posterior: suben directo a Storage.
          </Parrafo>
        </View>

        {preguntaCiclo && (
        <View style={styles.periodRow}>
          <Text style={styles.periodLabel}>Esta semana empezó mi periodo</Text>
          <Switch
            value={periodStarted}
            onValueChange={setPeriodStarted}
            trackColor={{ true: colors.guinda, false: colors.cardBorder }}
            thumbColor={colors.marfil}
          />
        </View>
        )}
      </Card>

      {generalError && <Text style={styles.generalError}>{generalError}</Text>}

      <Card>
        <SectionLabel>Fotos (opcional)</SectionLabel>
        <Parrafo style={styles.fotosNota}>
          Son las que se comparan contra tu objetivo. Con una basta para empezar, y no hace falta
          cada semana: una vez al mes dice lo mismo y cuesta la cuarta parte. Solo se ven en tu
          bóveda, detrás de tu clave.
        </Parrafo>

        <View style={styles.fotosRow}>
          {PHOTO_VIEWS.map((view) => {
            const puesta = Boolean(fotos[view]);
            return (
              <Pressable
                key={view}
                onPress={() => elegirFoto(view)}
                style={[styles.fotoSlot, puesta && styles.fotoSlotLista]}
              >
                <Camera
                  size={20}
                  color={puesta ? colors.pergamino : colors.paloRosa}
                  strokeWidth={2}
                />
                <Text style={[styles.fotoSlotText, puesta && styles.fotoSlotTextLista]}>
                  {PHOTO_VIEW_LABEL[view]}
                </Text>
                {puesta && <Text style={styles.fotoSlotOk}>lista</Text>}
              </Pressable>
            );
          })}
        </View>

        {fotosError && <Text style={styles.fotosError}>{fotosError}</Text>}
      </Card>

      <PrimaryButton label="Enviar check-in" onPress={handleSubmit} loading={submitting} />
    </ScrollView>
  );
}

function ScaleField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  error?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.scaleField}>
      <Text style={styles.scaleLabel}>{label.toUpperCase()}</Text>
      <Slider15 value={value} onChange={onChange} lowLabel="Nada" highLabel="Mucho" />
      {error && <Text style={styles.scaleError}>{error}</Text>}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  autoNota: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
  },
  mensualesLink: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.body,
    color: colors.champan,
    paddingVertical: spacing.sm,
  },
  fotosNota: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  fotosRow: { flexDirection: "row", gap: spacing.md },
  fotoSlot: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
  },
  fotoSlotLista: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
  fotoSlotText: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
  fotoSlotTextLista: { color: colors.pergamino },
  fotoSlotOk: { fontFamily: fonts.sans, ...typeScale.label, color: colors.pergaminoSoft },
  fotosError: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.error,
    marginTop: spacing.md,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  backText: {
    fontFamily: fonts.sansMedium,
    ...typeScale.body,
    color: colors.paloRosa,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.obsidiana,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.huge,
  },
  title: {
    fontFamily: fonts.display,
    ...typeScale.heading,
    color: colors.marfil,
  },
  fieldGroup: {
    marginTop: spacing.md,
    gap: spacing.lg,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  scaleField: {
    gap: spacing.xs,
  },
  scaleLabel: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 2,
    color: colors.paloRosa,
  },
  scaleError: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.error,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  commentField: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  commentLabel: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 2,
    color: colors.paloRosa,
  },
  commentInput: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    padding: spacing.md,
    minHeight: 80,
    fontFamily: fonts.sans,
    ...typeScale.body,
    color: colors.marfil,
    textAlignVertical: "top",
  },
  commentHint: {
    fontFamily: fonts.serifItalic,
    ...typeScale.label,
    color: colors.paloRosaLight,
  },
  rpeHint: {
    fontFamily: fonts.serifItalic,
    ...typeScale.body,
    color: colors.paloRosaLight,
    marginTop: spacing.xs,
  },
  periodRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  periodLabel: {
    fontFamily: fonts.sans,
    ...typeScale.body,
    color: colors.marfil,
    flex: 1,
    marginRight: spacing.md,
  },
  generalError: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.error,
    textAlign: "center",
  },
});
