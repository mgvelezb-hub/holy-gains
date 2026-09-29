import Foundation

/**
 Lo que el reloj sabe de la sesión.

 Es el espejo mínimo de lo que la app tiene en el teléfono: solo lo que se
 necesita para contestar "¿qué toca ahora?" en una pantalla de 40 mm. Nada de
 historial ni de catálogo — si el reloj tuviera que sincronizar todo eso,
 tardaría más en abrir de lo que tarda uno en sacar el teléfono del bolsillo.
 */
struct SerieEnVivo: Codable, Identifiable {
    var id: String { "\(indice)" }
    let indice: Int
    let objetivo: Int
    let pesoKg: Double?
    let calentamiento: Bool
    var hechas: Int?
}

struct EjercicioEnVivo: Codable, Identifiable {
    var id: String { nombre }
    let nombre: String
    /// El teléfono lo recalcula por esfuerzo, pulso y RPE, y reenvía la sesión
    /// cada vez que cambia — no es fijo por ejercicio. Un descanso ya
    /// corriendo se ajusta a este valor sin reiniciarse (ver el
    /// `.onChange(of: ejercicio.descansoSeg)` en `index.swift`, que llama a
    /// `Descanso.sumar` con la diferencia); el que arranca de cero siempre
    /// usa el más reciente porque `avanzar()` lo lee del mensaje que acaba de
    /// llegar.
    let descansoSeg: Int
    var series: [SerieEnVivo]
    /// Índices de `series` que el teléfono dejó sin hacer. Llegan con
    /// `hechas: nil` para siempre, así que sin esta lista el reloj se
    /// quedaría esperando una serie que nadie va a cerrar. Opcional a
    /// propósito: una sesión vieja o sin recorte no trae la llave, y entonces
    /// no se omite nada.
    var omitidas: [Int]? = nil

    /// `true` si el índice está en `omitidas` — el reloj no la espera ni
    /// ofrece cerrarla.
    func omitida(_ indice: Int) -> Bool {
        omitidas?.contains(indice) ?? false
    }
}

struct SesionEnVivo: Codable {
    let workoutId: String
    let titulo: String
    var ejercicios: [EjercicioEnVivo]

    /// La primera serie sin cerrar y no omitida, en el orden en que se
    /// entrena.
    var pendiente: (ejercicio: Int, serie: Int)? {
        for (e, ejercicio) in ejercicios.enumerated() {
            for (s, serie) in ejercicio.series.enumerated()
            where serie.hechas == nil && !ejercicio.omitida(s) {
                return (e, s)
            }
        }
        return nil
    }

    var progreso: (hechas: Int, total: Int) {
        var hechas = 0
        var total = 0
        for ejercicio in ejercicios {
            for (s, serie) in ejercicio.series.enumerated() {
                // Una serie omitida no cuenta ni como pendiente ni como
                // hecha: para el avance es como si no existiera.
                guard !ejercicio.omitida(s) else { continue }
                total += 1
                if serie.hechas != nil { hechas += 1 }
            }
        }
        return (hechas, total)
    }
}

/**
 Una serie cerrada desde el reloj, camino al teléfono.

 Lleva la muestra de movimiento cruda cuando la hay. Hoy nadie la interpreta:
 se guarda para poder calibrar el conteo automático con sesiones reales, que es
 exactamente el dato que falta para que ese conteo se pueda escribir sin
 inventar umbrales.
 */
struct SerieCerrada: Codable {
    let workoutId: String
    let ejercicioIndice: Int
    let serieIndice: Int
    let reps: Int
    let pesoKg: Double?
    let cerradaEn: Date
    /// Magnitud de aceleración del usuario, a 50 Hz. Vacío si no se grabó.
    var muestra: [Double]
    let duracionSeg: Double
}

/**
 Lo que el reloj enseña cuando no hay sesión abierta.

 Es el mismo puñado de datos que alimenta el widget del teléfono, y por la
 misma razón: son las cosas que se miran de reojo y no valen sacar nada del
 bolsillo. Sin esto, la app en la muñeca solo sirve mientras entrenas y el
 resto del día es un ícono muerto.
 */
struct ResumenDelDia: Codable {
    /// "Pierna", "Natación", "Descanso".
    let hoy: String
    let ejercicios: Int?
    let hecho: Bool
    /// "Comida 2". `nil` si ya no queda ninguna hoy.
    let comida: String?
    let comidaHora: String?
    /// Los alimentos de esa comida, ya formateados ("3 tortillas de maiz").
    ///
    /// Antes el reloj solo decia el NOMBRE de la comida y la hora, asi que
    /// para saber que tocaba comer habia que sacar el telefono — justo lo que
    /// la muneca deberia evitar. Llegan pocos y ya listos para pintar: el
    /// reloj no formatea gramos ni decide que cabe, eso se resolvio del lado
    /// del telefono donde estan los datos completos.
    let comidaItems: [String]?
    let racha: Int
}

/**
 La siguiente comida completa, tal como la arma el teléfono
 (`siguienteComida` en `src/lib/siguiente-comida.ts`): todos los alimentos,
 el platillo marcado y las tomas amarradas ("Ashwagandha 300 mg").

 Llega aparte del resumen, en la llave `siguienteComida` del contexto, porque
 el resumen solo traía tres alimentos y ninguna toma — justo lo que faltaba
 en la muñeca. `luego` son las que siguen hoy: la complicación las usa para
 avanzar sola a la hora de cada comida sin esperar al teléfono.
 */
struct SiguienteComidaReloj: Codable {
    struct Renglon: Codable, Hashable {
        let display: String
        var platillo: Bool? = nil
        var enPlatillo: Bool? = nil
    }

    struct Toma: Codable, Hashable {
        let nombre: String
        let dosis: String
    }

    let slot: String
    let nombre: String
    let hora: String
    let items: [Renglon]
    let tomas: [Toma]
    var luego: [SiguienteComidaReloj]? = nil
}
