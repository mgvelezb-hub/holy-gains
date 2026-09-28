/**
 * Tokens del brand kit "Holy Gains". Única fuente de verdad de colores,
 * spacing, radios y tipografías — nada de valores mágicos sueltos en pantallas.
 *
 * ---------------------------------------------------------------------------
 * Temas
 * ---------------------------------------------------------------------------
 * Hay 3 paletas (`paletteDark`, `paletteLight`, `paletteChampan`) más la
 * preferencia "sistema" (sigue claro/oscuro de iOS), resueltas por
 * `src/context/theme.tsx`. Las 3 comparten EXACTAMENTE las mismas llaves:
 * son ROLES, no colores literales. Por ejemplo `obsidiana` es el rol "fondo
 * de pantalla" — en el tema oscuro (el original) sí es obsidiana de verdad,
 * pero en el claro es pergamino y en Champán es negro casi puro. Lo mismo
 * pasa con `marfil` (rol "texto principal") o `guinda` (rol "acento
 * primario / CTA"): el nombre se queda, el valor cambia por tema.
 *
 * El único rol sin equivalente directo en el kit original es `pergamino`:
 * hoy no se usaba en ninguna pantalla (solo vivía declarado aquí), así que
 * se reutiliza como el rol "texto/ícono que va ENCIMA de un fondo de acento"
 * (botones CTA, checks marcados, chips seleccionados). Es necesario porque
 * `marfil` cambia de claro→oscuro entre temas (texto principal), pero el
 * texto que va sobre `guinda`/`champan` siempre necesita ser el opuesto del
 * fondo de la pantalla, no el del texto normal — en el tema oscuro ambos
 * coinciden por accidente (texto principal ya es claro), pero en Claro y
 * Champán no. `pergamino` es ese texto-sobre-acento en los 3 temas.
 *
 * Los valores de Claro y Champán se derivaron 1:1 de los oklch() de
 * `apps/web/src/app/globals.css` (`:root` y `.executive` respectivamente),
 * convertidos a hex sRGB con la fórmula estándar de OKLab (Björn Ottosson).
 * Champán es el mismo tema que la web llama ".executive" — en la app SIEMPRE
 * se le dice "Champán", nunca "Ejecutivo".
 */

export type Palette = {
  guinda: string;
  guindaDark: string;
  guindaLight: string;
  paloRosa: string;
  paloRosaLight: string;
  marfil: string;
  /** Rol: texto/ícono sobre un fondo de acento (guinda/champán). Ver nota arriba. */
  pergamino: string;
  /**
   * Rol: texto SECUNDARIO sobre un fondo de acento (la meta en itálica de la
   * tarjeta de decisión). No puede ser `champan`: en el tema Champán el acento
   * ya ES champán y el texto desaparecería sobre sí mismo.
   */
  pergaminoSoft: string;
  /** Rol: fondo de pantalla. */
  obsidiana: string;
  champan: string;
  champanSoft: string;
  error: string;
  cardBg: string;
  cardBorder: string;
};

/** Oscuro — el tema original de la app (obsidiana + guinda + marfil + champán). Default. */
export const paletteDark: Palette = {
  guinda: "#6B1F2E",
  guindaDark: "#4A1320",
  // Aclarado el 30/08 a 3.42 sobre el fondo: es el rol del BORDE de las
  // superficies de acento, y en oscuro un botón guinda sobre obsidiana da 1.66
  // de contraste de superficie — el texto se lee, la forma no. El borde es lo
  // que lo hace visible como botón sin tocar el guinda de marca.
  guindaLight: "#B24358",
  paloRosa: "#D4A5A5",
  paloRosaLight: "#E8CFCF",
  marfil: "#F5EDE4",
  pergamino: "#EDE2D3",
  pergaminoSoft: "#C9A961",
  obsidiana: "#1A0F12",
  champan: "#C9A961",
  champanSoft: "#D4B777",
  // Aclarado el 30/08: #C24A2E daba 3.85 sobre el fondo oscuro, por debajo del
  // 4.5 que pide el texto normal — y este rol carga avisos, que son justo lo
  // que hay que poder leer.
  error: "#E0765C",
  cardBg: "rgba(255,255,255,0.05)",
  cardBorder: "rgba(255,255,255,0.08)",
} as const;

/**
 * Claro — derivado de `:root` en globals.css: fondo pergamino claro, texto
 * guinda oscuro, acento champán.
 *
 * Dos tonos se corrigieron el 30/08 por CONTRASTE, no por gusto. Medidos con
 * la fórmula de WCAG contra la tarjeta (`cardBg` #FAF6F1) y contra el fondo de
 * pantalla (#F3EDE6), los originales quedaban por debajo del 4.5:1 que pide
 * el texto normal:
 *
 * - `paloRosaLight` #9D7D7E daba 3.44 y es el rol del texto terciario, que en
 *   esta app carga explicaciones enteras. Ahora #836062 → 5.12 / 4.74.
 * - `champan` #AE8D44 daba 2.92 y se usa para mensajes de confirmación y
 *   avisos, no solo para adorno. Ahora #7D5D2A → 5.62 / 5.20.
 *
 * En los temas Oscuro y Champán los mismos roles ya pasaban de 6:1; ahí no se
 * tocó nada. Un token de rol se arregla una vez y arregla las noventa y seis
 * pantallas que lo usan.
 */
export const paletteLight: Palette = {
  guinda: "#73202E",
  guindaDark: "#5A041A",
  guindaLight: "#8C3843",
  paloRosa: "#7B595B",
  paloRosaLight: "#836062",
  marfil: "#3C161C",
  pergamino: "#F3EDE6",
  pergaminoSoft: "#D9B978",
  obsidiana: "#F3EDE6",
  champan: "#7D5D2A",
  champanSoft: "#9A7A3C",
  error: "#D41101",
  cardBg: "#FAF6F1",
  cardBorder: "#DECEC1",
} as const;

/**
 * Champán — negro casi puro + acentos oro, derivado de `.executive` en
 * globals.css.
 *
 * El oro bajó de intensidad respecto a la primera versión (#DDB049 → #C0994F)
 * y el fondo dejó de ser negro absoluto (#020203 → #0C0C0E). Las dos cosas
 * atacan el mismo problema: un acento muy saturado contra negro puro produce
 * halación —el ojo ve el borde "vibrar"— y a los pocos minutos cansa. Con
 * menos croma en el oro y un fondo apenas levantado, el contraste sigue por
 * arriba de 7:1 para el texto y la pantalla se puede mirar un rato largo.
 *
 * El texto secundario también salió del oro: era oro sobre negro para leer
 * párrafos, que es justo donde más pesa. Ahora es un gris cálido, y el oro se
 * queda para lo que de verdad acentúa.
 */
export const paletteChampan: Palette = {
  guinda: "#C0994F",
  guindaDark: "#8E7130",
  guindaLight: "#D2B378",
  paloRosa: "#A79B88",
  paloRosaLight: "#8B9095",
  marfil: "#E9ECEF",
  pergamino: "#120E05",
  pergaminoSoft: "#3F3209",
  obsidiana: "#0C0C0E",
  champan: "#C0994F",
  champanSoft: "#D2B378",
  // Mismo caso que en Oscuro: 4.39 se quedaba corto para texto pequeño.
  error: "#E0765C",
  cardBg: "#141417",
  cardBorder: "rgba(255,255,255,0.10)",
} as const;

/** Retrocompatible: el tema oscuro tal cual estaba antes del sistema de temas. */
export const colors = paletteDark;

/**
 * `#RRGGBB` → `rgba(r,g,b,alpha)`. Para tintes translúcidos (badges, cards
 * "hechas") que antes estaban escritos a mano contra el hex del tema oscuro
 * — con esto se recalculan solos contra el color real del tema activo.
 * Si ya viene un color `rgba(...)` (como `cardBg`/`cardBorder` en oscuro y
 * Champán) se regresa tal cual: ya trae su propio alpha.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith("#")) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 999,
} as const;

/**
 * Escala tipográfica. Existe para que ninguna pantalla vuelva a escribir
 * `fontSize: 12` a mano.
 *
 * Los tamaños subieron de golpe respecto a la primera versión de la app: el
 * cuerpo estaba en 13-14 px y en un teléfono, a la distancia real a la que se
 * lee esto (con el celular en la mano, en el gimnasio, a veces sudado), 13 px
 * de Inter obliga a acercarse. El mínimo de cuerpo aquí es 15, y el número
 * grande de una tarjeta es 34-40: un dato se lee de un vistazo o no sirve.
 *
 * `lineHeight` viaja pegado al tamaño a propósito — el interlineado suelto es
 * la mitad de la legibilidad, y separarlos garantiza que alguien lo olvide.
 */
export const type = {
  /** El número que ES la pantalla (la racha de "Tu resumen"). Uno por vista. */
  hero: { fontSize: 56, lineHeight: 60 },
  /** Número protagonista de una tarjeta (racha, pasos, peso). */
  display: { fontSize: 40, lineHeight: 44 },
  /** Título de pantalla / dato grande secundario. */
  title: { fontSize: 28, lineHeight: 34 },
  /** Encabezado de tarjeta ("Hoy toca", "Pierna · cuádriceps"). */
  heading: { fontSize: 22, lineHeight: 28 },
  /** Subtítulo de tarjeta. */
  subheading: { fontSize: 18, lineHeight: 25 },
  /**
   * Cuerpo por defecto. Nada de texto largo por debajo de esto.
   *
   * Subió de 16 a 17 el 30/08: la app se lee de pie, con el teléfono a un
   * brazo de distancia y a veces con el pulso alto. El tamaño cómodo sentado
   * en un escritorio no es el mismo que en la banca del gimnasio.
   */
  body: { fontSize: 17, lineHeight: 26 },
  /** Cuerpo secundario (metadatos de una tarjeta). */
  bodySm: { fontSize: 15, lineHeight: 22 },
  /**
   * Etiqueta de sección / chip. 13 es el piso: nada por debajo de esto lleva
   * texto que alguien tenga que leer para decidir algo.
   */
  label: { fontSize: 13, lineHeight: 18 },
} as const;

/**
 * El párrafo: todo texto de cuerpo que pueda pasar de dos líneas va
 * justificado — se lee más formal. Solo alinea: tamaño y color siguen siendo
 * del estilo con el que se combine. Títulos, etiquetas de una línea, filas de
 * tarjeta, chips, botones y números NO lo llevan. Se usa vía `<Parrafo>`.
 */
export const parrafo = { textAlign: "justify" } as const;

/**
 * Sombras. En iOS levantan la tarjeta del fondo; en Android `elevation` hace
 * el mismo trabajo. Es lo que evita que la pantalla se vea como una lista de
 * rectángulos planos del mismo tono.
 */
export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  hero: {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;

/**
 * Nombres de familia tal cual los registra `useFonts` de cada paquete
 * `@expo-google-fonts/*`. Deben coincidir exactamente con las keys que se
 * cargan en `src/app/_layout.tsx`.
 */
export const fonts = {
  /**
   * Cinzel — la voz de la MARCA, no la de la interfaz.
   *
   * Es una romana de capitales, con remates finos y contraste alto: preciosa
   * en el wordmark y en un título corto, ilegible en un dato que se consulta
   * de reojo. Se quedó con el logo, los títulos de pantalla y poco más; todo
   * lo que se lee (números, etiquetas, cuerpo) pasó a Inter, que es de trazo
   * uniforme y no "pica" a 12 px.
   */
  display: "Cinzel_500Medium",
  displaySemiBold: "Cinzel_600SemiBold",
  serifItalic: "CormorantGaramond_500Medium_Italic",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  /** Números protagonistas y encabezados de tarjeta. */
  sansBold: "Inter_700Bold",
} as const;

export const theme = { colors, spacing, radius, type, parrafo, shadow, fonts } as const;
