import { ShoppingCart, Unlink, Users } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import { ApiError } from "@/lib/api";
import {
  getHousehold,
  postAceptar,
  postDisolver,
  postInvitar,
  type VinculoHousehold,
} from "@/lib/api-household";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Tu hogar" — el vínculo con otra cuenta (pareja, roommate) y lo que hoy
 * comparte: la lista del súper.
 *
 * EL CASO REAL: dos personas de la misma casa hacen el súper juntas, o se
 * turnan, y sin esto cada quien lleva su propia lista sin saber qué ya
 * marcó el otro — se compra doble o se deja algo fuera igual que con la
 * lista en papel que esto reemplaza.
 *
 * El vínculo se hace por CÓDIGO (no buscando cuentas por correo — ver
 * `apps/web/src/lib/household.ts`), así que esta tarjeta tiene dos caminos
 * para llegar a ACTIVO: generar un código y pasarlo de palabra, o teclear
 * el que ya te compartieron.
 *
 * El código en sí NUNCA lo devuelve `GET /household` (por diseño: esa ruta
 * solo dice si hay un vínculo, no expone el secreto). Por eso, si el
 * vínculo sigue PENDIENTE al abrir esta pantalla, se vuelve a pedir con
 * `postInvitar()` — es idempotente: mientras siga vigente, regresa el
 * mismo código en vez de generar uno nuevo.
 */
export function SeccionHogar() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [vinculo, setVinculo] = useState<VinculoHousehold>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Código de la invitación PENDIENTE — solo se conoce al generarla o al
  // volver a pedirla; el servidor no la incluye en el estado general.
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const [codigoInput, setCodigoInput] = useState("");
  const [aceptando, setAceptando] = useState(false);
  const [aceptarError, setAceptarError] = useState<string | null>(null);

  const [confirmandoDesvincular, setConfirmandoDesvincular] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);
  const [desvincularError, setDesvincularError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { vinculo: actual } = await getHousehold();
      setVinculo(actual);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu hogar");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pedirCodigo = useCallback(async () => {
    setGenerando(true);
    setError(null);
    try {
      const respuesta = await postInvitar();
      setCode(respuesta.code);
      setExpiresAt(respuesta.expiresAt);
      setVinculo({ status: "PENDIENTE", pareja: null, expiresAt: respuesta.expiresAt });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo generar tu código");
    } finally {
      setGenerando(false);
    }
  }, []);

  // Vínculo PENDIENTE pero sin el código en memoria (recién montada la
  // pantalla): se vuelve a pedir — reutiliza el mismo, no crea uno nuevo.
  useEffect(() => {
    if (vinculo?.status === "PENDIENTE" && !code && !generando) {
      void pedirCodigo();
    }
  }, [vinculo, code, generando, pedirCodigo]);

  async function aceptar() {
    const normalizado = codigoInput.trim().toUpperCase();
    if (normalizado.length === 0 || aceptando) return;
    setAceptando(true);
    setAceptarError(null);
    try {
      const { vinculo: nuevo } = await postAceptar(normalizado);
      setVinculo(nuevo);
      setCodigoInput("");
    } catch (e) {
      setAceptarError(e instanceof ApiError ? e.message : "No se pudo aceptar el código");
    } finally {
      setAceptando(false);
    }
  }

  async function desvincular() {
    if (desvinculando) return;
    setDesvinculando(true);
    setDesvincularError(null);
    try {
      await postDisolver();
      setVinculo(null);
      setCode(null);
      setExpiresAt(null);
      setConfirmandoDesvincular(false);
    } catch (e) {
      setDesvincularError(e instanceof ApiError ? e.message : "No se pudo desvincular");
    } finally {
      setDesvinculando(false);
    }
  }

  async function cancelarInvitacion() {
    await desvincular();
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Tu hogar</SectionLabel>
        <InfoTip titulo="Tu hogar">
          <TextoInfo>
            Vincula tu cuenta con la de alguien más de tu casa —pareja, roommate— para compartir
            la lista del súper: uno tacha lo que ya cayó al carrito y el otro lo ve al momento.
          </TextoInfo>
          <TextoInfo>
            El vínculo se hace con un código de 6 caracteres, vigente 48 horas, que compartes de
            palabra o por WhatsApp. La app nunca busca cuentas por correo.
          </TextoInfo>
        </InfoTip>
      </View>

      {cargando && (
        <View style={styles.estado}>
          <ActivityIndicator size="small" color={colors.champan} />
        </View>
      )}

      {!cargando && vinculo?.status === "ACTIVO" && (
        <View style={styles.activo}>
          <View style={styles.estado}>
            <Users size={18} color={colors.champan} strokeWidth={2} />
            <Text style={styles.estadoTexto}>Vinculado con {vinculo.pareja}.</Text>
          </View>
          <View style={styles.comparteFila}>
            <ShoppingCart size={16} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.comparteTexto}>Hoy comparte: la lista del súper.</Text>
          </View>

          {!confirmandoDesvincular ? (
            <Pressable onPress={() => setConfirmandoDesvincular(true)} style={styles.accionTexto}>
              <Unlink size={16} color={colors.error} strokeWidth={2} />
              <Text style={styles.desvincularTexto}>Desvincular</Text>
            </Pressable>
          ) : (
            <View style={styles.confirmFila}>
              <Text style={styles.confirmTexto}>¿Desvincular tu hogar?</Text>
              <View style={styles.confirmBotones}>
                <Pressable
                  onPress={() => setConfirmandoDesvincular(false)}
                  disabled={desvinculando}
                  style={styles.confirmBoton}
                >
                  <Text style={styles.confirmCancelar}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={desvincular} disabled={desvinculando} style={styles.confirmBoton}>
                  {desvinculando ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <Text style={styles.confirmDesvincular}>Sí, desvincular</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
          {desvincularError && <Text style={styles.error}>{desvincularError}</Text>}
        </View>
      )}

      {!cargando && vinculo?.status === "PENDIENTE" && (
        <View style={styles.pendiente}>
          <Parrafo style={styles.pendienteAviso}>
            Comparte este código con quien vas a vincular. Vigente hasta {fechaCorta(expiresAt)}.
          </Parrafo>
          {code ? (
            <Text style={styles.codigo}>{code}</Text>
          ) : (
            <ActivityIndicator size="small" color={colors.champan} style={styles.codigoCargando} />
          )}
          <Pressable onPress={cancelarInvitacion} disabled={desvinculando} style={styles.accionTexto}>
            <Text style={styles.cancelarTexto}>Cancelar</Text>
          </Pressable>
          {desvincularError && <Text style={styles.error}>{desvincularError}</Text>}
        </View>
      )}

      {!cargando && vinculo === null && (
        <View style={styles.sinVinculo}>
          <Pressable onPress={pedirCodigo} disabled={generando} style={styles.generarBoton}>
            {generando ? (
              <ActivityIndicator size="small" color={colors.pergamino} />
            ) : (
              <Text style={styles.generarTexto}>Generar código</Text>
            )}
          </Pressable>

          <Text style={styles.separador}>o</Text>

          <Text style={styles.cierreLabel}>Tengo un código</Text>
          <View style={styles.codigoFila}>
            <TextInput
              value={codigoInput}
              onChangeText={(texto) => setCodigoInput(texto.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              placeholderTextColor={colors.paloRosaLight}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              style={styles.codigoInput}
            />
            <Pressable
              onPress={aceptar}
              disabled={aceptando || codigoInput.trim().length === 0}
              style={[
                styles.aceptarBoton,
                (aceptando || codigoInput.trim().length === 0) && styles.aceptarBotonDeshabilitado,
              ]}
            >
              {aceptando ? (
                <ActivityIndicator size="small" color={colors.pergamino} />
              ) : (
                <Text style={styles.aceptarTexto}>Aceptar</Text>
              )}
            </Pressable>
          </View>
          {aceptarError && <Text style={styles.error}>{aceptarError}</Text>}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

/** "31 de agosto, 3:00 p.m." a partir de un ISO 8601. Sin ISO válido, un guion. */
function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  const dia = fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  const hora = fecha.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  return `${dia}, ${hora}`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    estado: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    estadoTexto: { flex: 1, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    activo: { gap: spacing.sm },
    comparteFila: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    comparteTexto: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    accionTexto: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginTop: spacing.sm,
      minHeight: 32,
    },
    desvincularTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.error },
    confirmFila: {
      marginTop: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      gap: spacing.sm,
    },
    confirmTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    confirmBotones: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.lg },
    confirmBoton: { minHeight: 32, justifyContent: "center" },
    confirmCancelar: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    confirmDesvincular: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.error },
    pendiente: { marginTop: spacing.md, gap: spacing.sm, alignItems: "center" },
    pendienteAviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      textAlign: "center",
      alignSelf: "stretch",
    },
    codigo: {
      fontFamily: fonts.sansBold,
      fontSize: 34,
      letterSpacing: 8,
      color: colors.champan,
      paddingVertical: spacing.sm,
    },
    codigoCargando: { paddingVertical: spacing.lg },
    cancelarTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    sinVinculo: { marginTop: spacing.md, gap: spacing.sm },
    generarBoton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.lg,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
    },
    generarTexto: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.pergamino,
      letterSpacing: 2,
    },
    separador: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.paloRosaLight,
      textAlign: "center",
    },
    cierreLabel: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    codigoFila: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    codigoInput: {
      flex: 1,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      letterSpacing: 3,
      color: colors.marfil,
    },
    aceptarBoton: {
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.lg,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
    },
    aceptarBotonDeshabilitado: { opacity: 0.5 },
    aceptarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.pergamino },
    error: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.error,
      marginTop: spacing.sm,
    },
  });
