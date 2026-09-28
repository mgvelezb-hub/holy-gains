import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import {
  ApiError,
  GOAL_VIEWS,
  GOAL_VIEW_LABEL,
  deleteGoalReference,
  getGoal,
  getMe,
  goalPhotoPath,
  patchReferencia,
  postGoalReference,
  type GoalReferenceUrl,
  type GoalResponse,
  type GoalView,
  type MeResponse,
} from "@/lib/api";
import {
  REFERENCIAS_CONOCIDAS,
  metasDesdeReferencia,
  type MedidasReferencia,
} from "@/lib/referencia";
import { supabase } from "@/lib/supabase";
import { fonts, radius, spacing, type Palette, type as typeScale } from "@/lib/theme";
import { useSession } from "@/context/session";
import { useTheme } from "@/context/theme";

/**
 * "Rumbo a tu objetivo" — pantalla empujada (fuera de tabs), espejo de
 * `/app/objetivo` en la web (apps/web/src/app/app/objetivo/page.tsx).
 *
 * Las 3 fotos de referencia se suben DIRECTO a Storage con la sesión de la
 * atleta (misma RLS que ya protege `progress-photos/{userId}/goal/*`); el
 * backend solo confirma que el objeto quedó ahí. El análisis por zona no se
 * arma aquí: `GET /api/v1/goal` ya lo manda como `lines: string[]` listo
 * para pintar, calculado del lado del servidor.
 */

/** Mismo bucket que `PHOTO_BUCKET` en apps/web/src/lib/env.ts. */
const GOAL_PHOTO_BUCKET = "progress-photos";

/** Texto de `GOAL_FRAMING` en apps/web/src/lib/coachy/goal.ts — es copia de
 * producto, no viene de la API porque ese módulo es server-only. */
const GOAL_FRAMING = [
  "La referencia es dirección, no promesa. Sirve para saber hacia dónde empujar, no para prometerte un resultado.",
  "Se comparan proporciones y hábitos, no identidades. Nunca vas a leer aquí qué tan parecida eres a alguien.",
  "Tu estructura ósea y tu distribución de grasa son tuyas y no se negocian. Dos cuerpos con el mismo entrenamiento y la misma comida llegan a siluetas distintas, y las dos están bien.",
];

function formatAnalyzedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

export default function ObjetivoScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId = session?.user.id ?? null;

  const [data, setData] = useState<GoalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyView, setBusyView] = useState<GoalView | null>(null);

  const load = useCallback(async () => {
    try {
      const goal = await getGoal();
      setData(goal);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu objetivo");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpload(view: GoalView) {
    if (!userId || busyView) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Falta permiso",
        "Necesitas dar acceso a tus fotos para subir una referencia.",
      );
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (picked.canceled || picked.assets.length === 0) return;

    setBusyView(view);
    try {
      const asset = picked.assets[0]!;
      const arrayBuffer = await fetch(asset.uri).then((response) => response.arrayBuffer());
      const path = goalPhotoPath(userId, view);

      const { error: uploadError } = await supabase.storage
        .from(GOAL_PHOTO_BUCKET)
        .upload(path, arrayBuffer, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      await postGoalReference(view);
      await load();
    } catch (e) {
      Alert.alert(
        "No se pudo subir la foto",
        e instanceof ApiError ? e.message : "Revisa tu conexión e intenta otra vez.",
      );
    } finally {
      setBusyView(null);
    }
  }

  function handleDelete(view: GoalView) {
    Alert.alert(
      `Quitar referencia de ${GOAL_VIEW_LABEL[view].toLowerCase()}`,
      "Se borra de tu objetivo. Puedes volver a subir otra cuando quieras.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar",
          style: "destructive",
          onPress: async () => {
            setBusyView(view);
            try {
              await deleteGoalReference(view);
              await load();
            } catch (e) {
              Alert.alert(
                "No se pudo quitar",
                e instanceof ApiError ? e.message : "Revisa tu conexión e intenta otra vez.",
              );
            } finally {
              setBusyView(null);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
          <Text style={styles.backText}>← Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Tu objetivo</Text>
        <Parrafo style={styles.subtitle}>
          Hasta tres fotos del físico al que le apuntas: frente, perfil y espalda.
        </Parrafo>

        <ReferenciaNumerica />

        <Card>
          <SectionLabel>Qué es y qué no es esta referencia</SectionLabel>
          <View style={styles.framingList}>
            {GOAL_FRAMING.map((line) => (
              <Text key={line} style={styles.framingLine}>
                {line}
              </Text>
            ))}
          </View>
        </Card>

        {!data && !error ? <LoadingState label="Cargando tu objetivo..." /> : null}
        {!data && error ? <ErrorState message={error} onRetry={load} /> : null}

        {data && (
          <>
            <Card>
              <View style={styles.slots}>
                {GOAL_VIEWS.map((view) => (
                  <Slot
                    key={view}
                    view={view}
                    reference={data.references.find((r) => r.view === view) ?? null}
                    busy={busyView === view}
                    disabled={busyView !== null && busyView !== view}
                    onUpload={() => handleUpload(view)}
                    onDelete={() => handleDelete(view)}
                  />
                ))}
              </View>
            </Card>

            <StatusCard status={data.status} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Slot({
  view,
  reference,
  busy,
  disabled,
  onUpload,
  onDelete,
}: {
  view: GoalView;
  reference: GoalReferenceUrl | null;
  busy: boolean;
  disabled: boolean;
  onUpload: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.slot}>
      <Text style={styles.slotLabel}>{GOAL_VIEW_LABEL[view]}</Text>

      <Pressable
        onPress={onUpload}
        disabled={busy || disabled}
        style={[styles.slotBox, reference && styles.slotBoxFilled]}
      >
        {busy ? (
          <ActivityIndicator color={colors.paloRosa} />
        ) : reference ? (
          <Image source={{ uri: reference.url }} style={styles.slotImage} contentFit="cover" />
        ) : (
          <Text style={styles.slotEmptyText}>Elegir{"\n"}foto</Text>
        )}
      </Pressable>

      {reference ? (
        <Pressable onPress={onDelete} disabled={busy || disabled} hitSlop={8}>
          <Text style={styles.slotDelete}>Quitar</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onUpload} disabled={busy || disabled} hitSlop={8}>
          <Text style={styles.slotDelete}>Subir</Text>
        </Pressable>
      )}
    </View>
  );
}

function StatusCard({ status }: { status: GoalResponse["status"] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (status.state === "sin_referencia") {
    return (
      <Card>
        <SectionLabel>Tu rumbo</SectionLabel>
        <EmptyState message="Estas tres fotos son a dónde vas, no un examen de cómo te ves hoy. Súbelas para empezar a comparar tu rumbo." />
      </Card>
    );
  }

  if (status.state === "sin_fotos") {
    return (
      <Card>
        <SectionLabel>Tu rumbo</SectionLabel>
        {status.lines.length === 0 ? (
          <EmptyState message="Ya tienes tu referencia guardada. En cuanto tu historial tenga fotos de progreso, aquí aparece la comparación." />
        ) : (
          <>
            {/* Sin fotos propias no se puede decir qué tan lejos estás —eso
                sería inventar—, pero sí qué implica la referencia en
                entrenamiento, que es accionable desde hoy. */}
            <Parrafo style={styles.statusIntro}>
              Esto es lo que implica tu referencia. Cuando subas fotos tuyas en un check-in, aquí
              va a aparecer además qué tan lejos estás de cada zona.
            </Parrafo>
            <View style={styles.statusLines}>
              {status.lines.map((line) => (
                <Text key={line} style={styles.statusLine}>
                  {line}
                </Text>
              ))}
            </View>
          </>
        )}
      </Card>
    );
  }

  if (status.state === "en_espera") {
    return (
      <Card>
        <SectionLabel>Tu rumbo</SectionLabel>
        <EmptyState message="El análisis se hace cada 2 semanas. Todavía no hay uno disponible — vuelve en unos días." />
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.statusHeader}>
        <SectionLabel color={colors.champan}>Tu rumbo</SectionLabel>
        <Text style={styles.statusDate}>Última revisión: {formatAnalyzedAt(status.analyzedAt)}</Text>
      </View>
      <View style={styles.statusLines}>
        {status.lines.map((line) => (
          <Text key={line} style={styles.statusLine}>
            {line}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/**
 * La referencia con números.
 *
 * Las fotos dan una lectura ordinal —de una foto no salen centímetros—. Cuando
 * la referencia tiene medidas publicadas, sí se puede aterrizar en metas, y
 * esta tarjeta es donde se capturan.
 *
 * Lo que NO hace: copiar los números. Se escalan por proporción a tu estatura,
 * la cintura nunca queda por encima de la mitad de tu estatura, y el
 * porcentaje de grasa no cruza de un sexo a otro — eso último se dice, no se
 * calla.
 */
function ReferenciaNumerica() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [referencia, setReferencia] = useState<MedidasReferencia | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    getMe()
      .then((perfil) => {
        if (!vivo) return;
        setMe(perfil);
        const guardada = perfil.profile?.goalReference;
        if (guardada && typeof guardada === "object") {
          setReferencia(guardada as MedidasReferencia);
        }
      })
      .catch(() => {
        // Sin perfil no hay escalado posible; la tarjeta lo dice sola.
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function guardar(nueva: MedidasReferencia | null) {
    setReferencia(nueva);
    setMensaje(null);
    try {
      await patchReferencia(nueva);
      setMensaje(nueva ? "Guardada. Tus metas por zona ya salen de ella." : "Referencia quitada.");
    } catch (error) {
      setMensaje(error instanceof ApiError ? error.message : "No se pudo guardar tu referencia");
    }
  }

  const lectura = referencia
    ? metasDesdeReferencia({
        estaturaCm: me?.profile?.heightCm ?? null,
        sexo: (me?.profile?.sex ?? null) as "FEMALE" | "MALE" | "OTHER" | null,
        referencia,
      })
    : null;

  return (
    <Card>
      <SectionLabel>Referencia con números</SectionLabel>

      {referencia ? (
        <>
          <Text style={styles.refNombre}>{referencia.nombre}</Text>
          <Text style={styles.refFuente}>
            {referencia.estaturaCm} cm · {referencia.cinturaCm ?? "—"} cm de cintura
            {referencia.grasaPct !== null ? ` · ${referencia.grasaPct} % de grasa` : ""}
          </Text>
          {referencia.fuente ? <Text style={styles.refFuente}>{referencia.fuente}</Text> : null}

          <View style={styles.refMetas}>
            {(lectura?.metas ?? []).map((meta) => (
              <View key={meta.label} style={styles.refFila}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.refZona}>{meta.label}</Text>
                  <Text style={styles.refOrigen}>{meta.origen}</Text>
                </View>
                <Text style={styles.refValor}>{meta.metaCm} cm</Text>
              </View>
            ))}
          </View>

          {(lectura?.avisos ?? []).map((aviso) => (
            <Parrafo key={aviso} style={styles.refAviso}>
              {aviso}
            </Parrafo>
          ))}

          <Pressable onPress={() => guardar(null)} hitSlop={8}>
            <Text style={styles.refQuitar}>Quitar esta referencia</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Parrafo style={styles.refIntro}>
            Si tu referencia tiene medidas publicadas, aquí se convierten en metas por zona
            escaladas a tu cuerpo. Sin ellas, la comparación se queda en la lectura de tus fotos.
          </Parrafo>

          <Pressable onPress={() => setAbierto((valor) => !valor)} hitSlop={8}>
            <Text style={styles.refQuitar}>
              {abierto ? "Cerrar" : "Usar una referencia con medidas →"}
            </Text>
          </Pressable>

          {abierto &&
            REFERENCIAS_CONOCIDAS.map((conocida) => (
              <Pressable
                key={conocida.nombre}
                onPress={() => guardar(conocida)}
                style={styles.refOpcion}
              >
                <Text style={styles.refZona}>{conocida.nombre}</Text>
                <Text style={styles.refOrigen}>{conocida.fuente}</Text>
              </Pressable>
            ))}
        </>
      )}

      {mensaje && <Parrafo style={styles.refAviso}>{mensaje}</Parrafo>}
    </Card>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  refIntro: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa, marginTop: spacing.sm },
  refNombre: { fontFamily: fonts.sansBold, ...typeScale.subheading, color: colors.marfil, marginTop: spacing.sm },
  refFuente: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  refMetas: { marginTop: spacing.md, gap: spacing.sm },
  refFila: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  refZona: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  refOrigen: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  refValor: { fontFamily: fonts.sansBold, ...typeScale.subheading, color: colors.champan },
  refAviso: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.champan,
    marginTop: spacing.md,
  },
  refQuitar: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.body,
    color: colors.paloRosa,
    marginTop: spacing.md,
  },
  refOpcion: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 2,
  },
  statusIntro: {
    fontFamily: fonts.sans,
    ...typeScale.body,
    color: colors.paloRosaLight,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
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
  backRow: { flexDirection: "row", alignItems: "center" },
  backText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  title: {
    fontFamily: fonts.display,
    ...typeScale.title,
    color: colors.marfil,
  },
  subtitle: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    marginTop: -spacing.sm,
  },
  framingList: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  framingLine: {
    fontFamily: fonts.serifItalic,
    ...typeScale.subheading,
    color: colors.paloRosaLight,
  },
  slots: {
    flexDirection: "row",
    gap: spacing.md,
  },
  slot: {
    flex: 1,
    gap: spacing.xs,
    alignItems: "center",
  },
  slotLabel: {
    fontFamily: fonts.sansMedium,
    ...typeScale.label,
    color: colors.marfil,
  },
  slotBox: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slotBoxFilled: {
    borderStyle: "solid",
    borderColor: colors.guindaLight,
  },
  slotImage: {
    width: "100%",
    height: "100%",
  },
  slotEmptyText: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
    textAlign: "center",
  },
  slotDelete: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 1.5,
    color: colors.paloRosa,
  },
  statusHeader: {
    gap: 2,
  },
  statusDate: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
  },
  statusLines: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  statusLine: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.marfil,
  },
});
