import Foundation
import WidgetKit

/**
 Lo que la app del reloj le deja a la complicación.

 Son dos procesos distintos —la app y la extensión de WidgetKit— que no
 comparten memoria. El único puente entre ellos es el App Group, y ahí no
 viaja un objeto: viajan llaves sueltas de `UserDefaults`.

 **Contrato**: los nombres de abajo tienen que coincidir letra por letra con
 los que lee `Resumen.leer()` en el target `watch-complicacion`. Un nombre mal
 escrito no rompe la compilación; se ve como una complicación vacía, que es el
 peor modo de fallar porque parece que la carátula simplemente no cargó.

 Los opcionales viajan como cadena vacía y como -1 porque `UserDefaults` no
 distingue "no hay valor" de "el valor es cero": sin ese truco, una comida
 ausente y una comida llamada "" se leerían igual.
 */
enum Compartido {
    static let grupo = "group.com.holygains.app"

    static func guardar(_ resumen: ResumenDelDia) {
        guard let disco = UserDefaults(suiteName: grupo) else { return }

        disco.set(resumen.hoy, forKey: "reloj.hoy")
        disco.set(resumen.ejercicios ?? -1, forKey: "reloj.ejercicios")
        disco.set(resumen.hecho, forKey: "reloj.hecho")
        disco.set(resumen.comida ?? "", forKey: "reloj.comida")
        disco.set(resumen.comidaHora ?? "", forKey: "reloj.comidaHora")
        // `reloj.comidaItems` ya no sale de aquí: lo escribe `guardar(comida:)`
        // con la lista completa en JSON. Si el teléfono es viejo y no manda la
        // comida completa, se deja lo del resumen en el mismo formato.
        if disco.string(forKey: "reloj.comidaSlot") == nil {
            let renglones = (resumen.comidaItems ?? []).map { SiguienteComidaReloj.Renglon(display: $0) }
            disco.set(json(renglones), forKey: "reloj.comidaItems")
        }
        disco.set(resumen.racha, forKey: "reloj.racha")

        // Sin esto la carátula se queda con lo de ayer hasta que al sistema se
        // le ocurra refrescar, que puede ser horas.
        WidgetCenter.shared.reloadAllTimelines()
    }

    /**
     La siguiente comida completa, para la complicación: `reloj.comidaItems`
     (JSON de renglones), `reloj.comidaTomas` (JSON de tomas) y
     `reloj.comidasLuego` (las que siguen hoy, para las entradas del timeline).
     Pisa `reloj.comida` y `reloj.comidaHora` del resumen: esta es la buena.
     */
    static func guardar(comida: SiguienteComidaReloj?) {
        guard let disco = UserDefaults(suiteName: grupo) else { return }

        if let comida {
            disco.set(comida.slot, forKey: "reloj.comidaSlot")
            disco.set(comida.nombre, forKey: "reloj.comida")
            disco.set(comida.hora, forKey: "reloj.comidaHora")
            disco.set(json(comida.items), forKey: "reloj.comidaItems")
            disco.set(json(comida.tomas), forKey: "reloj.comidaTomas")
            let luego = (comida.luego ?? []).map { siguiente -> SiguienteComidaReloj in
                var sola = siguiente
                sola.luego = nil
                return sola
            }
            disco.set(json(luego), forKey: "reloj.comidasLuego")
        } else {
            disco.removeObject(forKey: "reloj.comidaSlot")
            disco.set("", forKey: "reloj.comida")
            disco.set("", forKey: "reloj.comidaHora")
            disco.set("[]", forKey: "reloj.comidaItems")
            disco.set("[]", forKey: "reloj.comidaTomas")
            disco.set("[]", forKey: "reloj.comidasLuego")
        }

        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func json<T: Encodable>(_ valor: T) -> String {
        guard let data = try? JSONEncoder().encode(valor) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}
