import preparacionesData from '../data/preparaciones.json';
import type { Preparacion } from './types.js';

/**
 * Catalogo de platillos compuestos: licuados, sopas, cremas y caldos.
 *
 * Nacio de una omision, no de una regla: el motor solo sabia servir alimentos
 * sueltos, y un licuado o una crema son parte de cualquier dieta mexicana de
 * gimnasio. Cada platillo se arma con alimentos del catalogo —ninguno trae
 * macros propios— para que el motor lo resuelva con las mismas cotas,
 * composicion y afinidad que cualquier comida.
 */
export const PREPARACIONES: Preparacion[] = preparacionesData as Preparacion[];
