/**
 * Versión de las reglas que arman menús.
 *
 * SE INCREMENTA cada vez que cambia una regla que altera qué sale en un menú
 * (catálogo, plantillas, reglas culinarias, porciones, preparaciones). La app
 * guarda esta versión con cada menú generado (`versionMotor` en
 * `MealPlan.mealsJson`) y, al leer el plan, rehace sola los menús guardados
 * con una versión menor: misma decisión, misma semilla, mismas preferencias.
 * Cambios que no alteran menús (textos, fases, macros) no la mueven.
 *
 * 1 — los menús de antes de la auditoría de 70 menús (sin versión guardada).
 * 2 — las 15 reglas culinarias de la auditoría (2116d0f, 2403fda, 6c1488c).
 */
export const MENU_ENGINE_VERSION = 2;
