import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polygon, Text as SvgText } from "react-native-svg";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { fonts, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

export type Eje = {
  /** Etiqueta corta: en la telaraña no cabe una frase. */
  label: string;
  /** 0 a 1 — qué tan cerca está de su meta. `null` = sin dato. */
  value: number | null;
  /**
   * Lo que se esperaba a estas alturas, también de 0 a 1.
   *
   * Sin esto la telaraña miente por omisión: un polígono ancho se lee como
   * "voy bien" aunque a mitad de semana llevar dos de cinco sesiones sea ir
   * atrasado. Con la referencia dibujada detrás, lo que se compara es tu
   * forma contra la esperada, no contra el borde del dibujo.
   */
  esperado?: number | null;
  /** El dato real, con su unidad: "8 420 pasos". */
  detalle?: string | null;
  /** Contra qué se compara: "de 8 000". */
  referencia?: string | null;
};

/**
 * Telaraña de perfil: qué tan cerca estás de tu meta en cada frente.
 *
 * Sirve para lo que ninguna tarjeta suelta puede: enseñar el **desbalance**.
 * Seis números en fila se leen uno por uno; el mismo perfil dibujado se lee de
 * golpe — se ve que el polígono está hundido de un lado, y ese hundimiento es
 * la conversación.
 *
 * Cada eje llega ya normalizado a 0-1 contra SU meta (`lib/perfil.ts`), porque
 * pasos, horas de sueño y kilos no comparten unidad y solo son comparables
 * como fracción de su propio objetivo. Un eje sin dato se dibuja en el centro
 * pero se marca en la leyenda: hundido por falta de dato y hundido de verdad
 * no son lo mismo, y confundirlos haría mentir al dibujo.
 */
export function RadarChart({ ejes, size = 240 }: { ejes: Eje[] | undefined; size?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const center = size / 2;
  // Menos radio: las etiquetas ahora llevan su valor debajo y necesitan aire.
  const radio = center * 0.56;
  const lista = ejes ?? [];
  const total = lista.length;

  if (total < 3) return null;

  /** Ángulo del eje `index`, arrancando arriba y girando a la derecha. */
  function punto(index: number, fraccion: number): { x: number; y: number } {
    const angulo = (Math.PI * 2 * index) / total - Math.PI / 2;
    return {
      x: center + Math.cos(angulo) * radio * fraccion,
      y: center + Math.sin(angulo) * radio * fraccion,
    };
  }

  const anillos = [0.25, 0.5, 0.75, 1];

  /** El polígono de lo esperado. `null` si ningún eje trae referencia. */
  const esperadoPoligono = lista.some((eje) => typeof eje.esperado === "number")
    ? lista
        .map((eje, index) => {
          const fraccion = Math.max(0, Math.min(1, eje.esperado ?? 0));
          const { x, y } = punto(index, fraccion);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : null;

  const poligono = lista
    .map((eje, index) => {
      // Un eje sin dato no se estira: se queda pegado al centro y la leyenda
      // lo dice. Rellenarlo con el promedio sería inventar.
      const fraccion = Math.max(0, Math.min(1, eje.value ?? 0));
      const { x, y } = punto(index, fraccion);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View style={styles.wrap}>
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={styles.grafico}
      >
        {anillos.map((anillo) => (
          <Circle
            key={anillo}
            cx={center}
            cy={center}
            r={radio * anillo}
            stroke={withAlpha(colors.paloRosa, anillo === 1 ? 0.35 : 0.15)}
            strokeWidth={1}
            fill="none"
          />
        ))}

        {/* Radios y etiquetas van en dos pasadas y NO dentro de un Fragment:
            react-native-svg recorre los hijos esperando elementos SVG, y un
            Fragment en medio lo tira en el lado nativo — sin traza de JS, la
            pantalla entera se cae. */}
        {lista.map((eje, index) => {
          const fin = punto(index, 1);
          return (
            <Line
              key={`eje-${eje.label}`}
              x1={center}
              y1={center}
              x2={fin.x}
              y2={fin.y}
              stroke={withAlpha(colors.paloRosa, 0.2)}
              strokeWidth={1}
            />
          );
        })}

        {/* Nombre y valor van juntos en la punta del eje: la tabla de abajo
            hacía la tarjeta larguísima para decir lo que cabe aquí mismo. El
            detalle completo está a un toque. */}
        {lista.map((eje, index) => {
          const etiqueta = punto(index, 1.34);
          const desvio =
            eje.value === null || typeof eje.esperado !== "number" || eje.esperado === null
              ? null
              : Math.round((eje.value - eje.esperado) * 100);
          const anclaje =
            Math.abs(etiqueta.x - center) < 6 ? "middle" : etiqueta.x > center ? "start" : "end";

          return (
            <SvgText
              key={`label-${eje.label}`}
              x={etiqueta.x}
              y={etiqueta.y}
              fill={colors.paloRosa}
              fontSize={11}
              fontFamily={fonts.sansSemiBold}
              textAnchor={anclaje}
            >
              {eje.label}
            </SvgText>
          );
        })}

        {lista.map((eje, index) => {
          const etiqueta = punto(index, 1.34);
          const desvio =
            eje.value === null || typeof eje.esperado !== "number" || eje.esperado === null
              ? null
              : Math.round((eje.value - eje.esperado) * 100);
          const anclaje =
            Math.abs(etiqueta.x - center) < 6 ? "middle" : etiqueta.x > center ? "start" : "end";

          return (
            <SvgText
              key={`valor-${eje.label}`}
              x={etiqueta.x}
              y={etiqueta.y + 14}
              fill={
                desvio === null
                  ? colors.paloRosaLight
                  : desvio < -5
                    ? colors.error
                    : colors.champan
              }
              fontSize={12}
              fontFamily={fonts.sansBold}
              textAnchor={anclaje}
            >
              {eje.value === null
                ? "—"
                : desvio === null
                  ? `${Math.round(eje.value * 100)}%`
                  : `${desvio > 0 ? "+" : ""}${desvio}`}
            </SvgText>
          );
        })}

        {/* Primero lo esperado, detrás y en otro tono: es el fondo contra el
            que se lee tu forma. Va antes que tu polígono para quedar debajo. */}
        {esperadoPoligono && (
          <Polygon
            points={esperadoPoligono}
            fill={withAlpha(colors.paloRosa, 0.16)}
            stroke={withAlpha(colors.paloRosa, 0.55)}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        <Polygon
          points={poligono}
          fill={withAlpha(colors.champan, 0.28)}
          stroke={colors.champan}
          strokeWidth={2}
        />

        {lista.map((eje, index) => {
          const { x, y } = punto(index, Math.max(0, Math.min(1, eje.value ?? 0)));
          return (
            <Circle
              key={`p-${eje.label}`}
              cx={x}
              cy={y}
              r={3.5}
              fill={eje.value === null ? withAlpha(colors.paloRosa, 0.5) : colors.champan}
            />
          );
        })}
      </Svg>

      {esperadoPoligono && (
        <Parrafo style={styles.pie}>
          Los números son tu diferencia contra lo esperado, en puntos. La silueta punteada es lo
          que tocaba a estas alturas.
        </Parrafo>
      )}

      {lista.some((eje) => eje.value === null) && (
        <Parrafo style={styles.nota}>
          Los ejes sin dato ({lista.filter((e) => e.value === null).map((e) => e.label).join(", ")})
          se dibujan en el centro: falta medirlos, no es que estén en cero.
        </Parrafo>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  // El gráfico se centra solo; el texto de abajo se alinea a la izquierda como
  // el resto de la tarjeta. Con `alignItems: center` en el contenedor, los
  // párrafos quedaban colgando al centro y se leían como pie de foto.
  wrap: { gap: spacing.sm, alignSelf: "stretch" },
  grafico: { alignSelf: "center" },
  // El pie del gráfico se lee como texto, no como etiqueta: alineado a la
  // izquierda, igual que el resto de la tarjeta. Centrado se ve como si
  // perteneciera al dibujo y no a la explicación.
  pie: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
  },
  nota: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
  },
});
