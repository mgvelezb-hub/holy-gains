import { Text, type TextProps } from "react-native";

import { parrafo } from "@/lib/theme";

/**
 * Un `Text` de cuerpo, justificado. Recibe el mismo `style` de siempre (tamaño,
 * color, fuente) y encima pone `parrafo`, así que la justificación gana aunque
 * el estilo traiga otra alineación. En Android el guionado evita los "ríos"
 * de espacios que deja justificar sin cortar palabras.
 */
export function Parrafo({ style, ...props }: TextProps) {
  return <Text {...props} style={[style, parrafo]} android_hyphenationFrequency="full" />;
}
