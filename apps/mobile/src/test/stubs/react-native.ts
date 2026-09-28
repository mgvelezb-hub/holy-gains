/**
 * Stub de `react-native` para las pruebas de lógica pura.
 *
 * Los módulos de `src/lib` importan tipos y constantes de `api.ts`, que a su
 * vez arrastra el cliente de Supabase y con él a React Native. Vitest corre en
 * Node y no sabe leer el Flow del `index.js` de RN.
 *
 * Este stub existe para cortar esa cadena, no para simular RN: si una prueba
 * necesita de verdad algo de aquí, es señal de que está probando un
 * componente, y los componentes no se prueban en esta suite.
 */
export const Platform = { OS: "ios", select: <T,>(opciones: { ios?: T; default?: T }) => opciones.ios ?? opciones.default };
export const StyleSheet = { create: <T,>(estilos: T): T => estilos };
export const Vibration = { vibrate: () => {} };
/** Solo para leer las props de un elemento (`Parrafo`), no para pintarlo. */
export const Text = "Text";
export default { Platform, StyleSheet, Vibration, Text };
