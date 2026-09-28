import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, ChevronLeft, Lock, ScanFace } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { Parrafo } from "@/components/Parrafo";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionLabel } from "@/components/SectionLabel";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  PHOTO_BUCKET,
  PHOTO_VIEWS,
  PHOTO_VIEW_LABEL,
  getHistoryMeasurements,
  getPhotos,
  postCheckinPhoto,
  progressPhotoPath,
  type PhotoView,
  type ProgressPhoto,
} from "@/lib/api";
import { useSession } from "@/context/session";
import { supabase } from "@/lib/supabase";
import {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  biometricsEnabled,
  hasPin,
  promptBiometrics,
  verifyPin,
} from "@/lib/vault";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * La bóveda: el único lugar donde se ven las fotos de progreso.
 *
 * Están escondidas del resto de la app a propósito —no aparecen en Resumen ni
 * en el historial— y aquí se pide una clave del teléfono antes de pintarlas.
 * La clave la valida `lib/vault.ts` contra un hash guardado en el Keychain;
 * el servidor no la conoce ni la necesita: es una cerradura contra el vistazo
 * ajeno, no una segunda sesión.
 *
 * Las fotos no se cachean en disco: se piden con URL firmada cada vez que se
 * abre la bóveda, y esas URLs caducan. Guardar copias locales sería
 * reintroducir por la puerta de atrás justo lo que esta pantalla evita.
 */

type Estado = "verificando" | "bloqueada" | "abierta" | "sin_clave";

export default function FotosScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();

  const [estado, setEstado] = useState<Estado>("verificando");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [fotos, setFotos] = useState<ProgressPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useSession();
  /** El check-in más reciente: al que se le pegan las fotos que se agreguen. */
  const [ultimoCheckIn, setUltimoCheckIn] = useState<{ id: string; date: string } | null>(null);
  const [subiendo, setSubiendo] = useState<PhotoView | null>(null);
  const [avisoSubida, setAvisoSubida] = useState<string | null>(null);

  const abrir = useCallback(async () => {
    setEstado("abierta");
    try {
      const [{ fotos: lista }, medidas] = await Promise.all([
        getPhotos(),
        getHistoryMeasurements().catch(() => null),
      ]);
      setFotos(lista);
      // Los puntos llegan del más viejo al más reciente.
      const ultimo = medidas?.points[medidas.points.length - 1] ?? null;
      setUltimoCheckIn(ultimo ? { id: ultimo.id, date: ultimo.date } : null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar tus fotos");
    }
  }, []);

  // Al entrar: si no hay clave configurada se dice y no se enseña nada; si hay
  // y la biometría está prendida, se ofrece la cara antes que el teclado.
  useEffect(() => {
    void (async () => {
      if (!(await hasPin())) {
        setEstado("sin_clave");
        return;
      }
      if (await biometricsEnabled()) {
        const intento = await promptBiometrics();
        if (intento.ok) {
          await abrir();
          return;
        }
        if (!intento.ok && intento.motivo) setPinError(intento.motivo);
      }
      setEstado("bloqueada");
    })();
  }, [abrir]);

  async function intentarPin() {
    if (await verifyPin(pin)) {
      setPin("");
      setPinError(null);
      await abrir();
      return;
    }
    setPin("");
    setPinError("Esa no es tu clave.");
  }

  /**
   * Agrega una foto al check-in más reciente, sin crear uno nuevo.
   *
   * Existe porque la única forma de subir fotos era mandando un check-in
   * completo: quien se acordaba tarde de las fotos terminaba con dos check-ins
   * del mismo periodo, uno con medidas y otro solo por las fotos.
   */
  async function agregarFoto(view: PhotoView) {
    const userId = session?.user.id;
    if (!userId || !ultimoCheckIn || subiendo) return;

    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      setAvisoSubida("Necesitas dar acceso a tus fotos.");
      return;
    }

    const elegida = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: false,
    });
    if (elegida.canceled || elegida.assets.length === 0) return;

    setSubiendo(view);
    setAvisoSubida(null);
    try {
      const archivo = await fetch(elegida.assets[0]!.uri).then((r) => r.arrayBuffer());
      const { error: subida } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(progressPhotoPath(userId, ultimoCheckIn.id, view), archivo, {
          upsert: true,
          contentType: "image/jpeg",
        });
      if (subida) throw subida;

      await postCheckinPhoto(ultimoCheckIn.id, view);
      await abrir();
      setAvisoSubida(`Foto de ${PHOTO_VIEW_LABEL[view].toLowerCase()} agregada a tu check-in del ${ultimoCheckIn.date}.`);
    } catch (e) {
      setAvisoSubida(e instanceof ApiError ? e.message : "No se pudo subir esa foto.");
    } finally {
      setSubiendo(null);
    }
  }

  const columnas = width >= 500 ? 3 : 2;
  const ancho = (width - spacing.lg * 2 - spacing.md * (columnas - 1)) / columnas;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Tus fotos</Text>

        {estado === "verificando" && <LoadingState label="Abriendo tu bóveda..." />}

        {estado === "sin_clave" && (
          <Card>
            <SectionLabel>Sin clave todavía</SectionLabel>
            <EmptyState message="Para ver tus fotos aquí, primero crea una clave en Ajustes. Es distinta a la de tu teléfono a propósito: quien ya desbloqueó tu celular no debería poder abrirlas." />
            <PrimaryButton label="Ir a Ajustes" onPress={() => router.replace("/ajustes/fotos")} />
          </Card>
        )}

        {estado === "bloqueada" && (
          <Card>
            <View style={styles.lockHeader}>
              <Lock size={22} color={colors.champan} strokeWidth={2} />
              <Text style={styles.lockTitle}>Escribe tu clave</Text>
            </View>

            <TextInput
              value={pin}
              onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))}
              placeholder={"•".repeat(MIN_PIN_LENGTH)}
              placeholderTextColor={colors.paloRosaLight}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.pinInput}
              autoFocus
            />

            {pinError && <Text style={styles.pinError}>{pinError}</Text>}

            <PrimaryButton
              label="Abrir"
              onPress={intentarPin}
              disabled={pin.length < MIN_PIN_LENGTH}
            />

            <Pressable
              onPress={async () => {
                const intento = await promptBiometrics();
                if (intento.ok) {
                  await abrir();
                  return;
                }
                if (intento.motivo) setPinError(intento.motivo);
              }}
              style={styles.biometria}
              hitSlop={8}
            >
              <ScanFace size={18} color={colors.paloRosa} strokeWidth={2} />
              <Text style={styles.biometriaText}>Usar Face ID o Touch ID</Text>
            </Pressable>
          </Card>
        )}

        {estado === "abierta" && (
          <>
            {error && <ErrorState message={error} onRetry={abrir} />}
            {!error && fotos === null && <LoadingState label="Cargando tus fotos..." />}
            {!error && ultimoCheckIn && (
              <Card>
                <SectionLabel>Agregar al último check-in</SectionLabel>
                <Parrafo style={styles.agregarNota}>
                  Se pegan al check-in del {ultimoCheckIn.date}, sin crear uno nuevo.
                </Parrafo>
                <View style={styles.agregarRow}>
                  {PHOTO_VIEWS.map((view) => (
                    <Pressable
                      key={view}
                      onPress={() => agregarFoto(view)}
                      disabled={subiendo !== null}
                      style={[styles.agregarSlot, subiendo === view && styles.agregarSlotActivo]}
                    >
                      <Camera size={18} color={colors.paloRosa} strokeWidth={2} />
                      <Text style={styles.agregarSlotText}>{PHOTO_VIEW_LABEL[view]}</Text>
                    </Pressable>
                  ))}
                </View>
                {avisoSubida && <Parrafo style={styles.agregarAviso}>{avisoSubida}</Parrafo>}
              </Card>
            )}

            {!error && fotos !== null && fotos.length === 0 && (
              <Card>
                <EmptyState message="Todavía no subes fotos de progreso. Se agregan en el check-in y son opcionales." />
              </Card>
            )}
            {!error && fotos !== null && fotos.length > 0 && (
              <View style={styles.galeria}>
                {fotos.map((foto) => (
                  <View key={foto.id} style={{ width: ancho }}>
                    {foto.url ? (
                      <Image
                        source={{ uri: foto.url }}
                        style={[styles.foto, { width: ancho, height: ancho * 1.35 }]}
                        contentFit="cover"
                        transition={150}
                      />
                    ) : (
                      <View style={[styles.foto, styles.fotoRota, { width: ancho, height: ancho * 1.35 }]}>
                        <Text style={styles.fotoRotaText}>Sin cargar</Text>
                      </View>
                    )}
                    <Text style={styles.fotoPie}>
                      {PHOTO_VIEW_LABEL[foto.view]} · {foto.date}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidiana },
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
  title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
  lockHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lockTitle: { fontFamily: fonts.sansSemiBold, ...typeScale.heading, color: colors.marfil },
  pinInput: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    paddingVertical: spacing.lg,
    textAlign: "center",
    letterSpacing: 12,
    fontFamily: fonts.sansBold,
    ...typeScale.title,
    color: colors.marfil,
  },
  pinError: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.error,
    marginBottom: spacing.md,
  },
  biometria: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  biometriaText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
  agregarNota: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  agregarRow: { flexDirection: "row", gap: spacing.sm },
  agregarSlot: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
  },
  agregarSlotActivo: { opacity: 0.5 },
  agregarSlotText: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
  agregarAviso: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.champan,
    marginTop: spacing.md,
  },
  galeria: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  foto: { borderRadius: radius.xl, backgroundColor: colors.cardBg },
  fotoRota: { alignItems: "center", justifyContent: "center" },
  fotoRotaText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  fotoPie: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.paloRosa,
    marginTop: spacing.xs,
  },
});
