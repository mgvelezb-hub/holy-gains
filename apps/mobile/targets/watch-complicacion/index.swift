import SwiftUI
import WidgetKit

/**
 Complicaciones de Holy Gains.

 **Contrato con la app del reloj**: las llaves de abajo tienen que coincidir
 letra por letra con las que escribe `Compartido.guardar` en el target `watch`.
 Son dos procesos distintos que solo se hablan por `UserDefaults` del App
 Group, así que un nombre mal escrito no falla al compilar: se ve como una
 complicación vacía, que es el peor modo de fallar.

 Nada de red. Una complicación se pinta con lo último que la app dejó escrito,
 y la app escribe cada vez que el teléfono le manda el resumen del día.
 */

private let GRUPO = "group.com.holygains.app"

struct Resumen {
    let hoy: String
    let ejercicios: Int?
    let hecho: Bool
    let comida: String?
    let comidaHora: String?
    let racha: Int

    /// Lo que se pinta cuando todavía no hay nada guardado. No dice "vacío":
    /// dice algo que se entiende sin explicación.
    static let vacio = Resumen(
        hoy: "—",
        ejercicios: nil,
        hecho: false,
        comida: nil,
        comidaHora: nil,
        racha: 0
    )

    static func leer() -> Resumen {
        guard let disco = UserDefaults(suiteName: GRUPO),
              let hoy = disco.string(forKey: "reloj.hoy") else {
            return .vacio
        }

        // Los opcionales viajan como cadena vacía y como -1: `UserDefaults` no
        // distingue "no hay valor" de "el valor es cero".
        let ejercicios = disco.integer(forKey: "reloj.ejercicios")
        let comida = disco.string(forKey: "reloj.comida") ?? ""
        let hora = disco.string(forKey: "reloj.comidaHora") ?? ""

        return Resumen(
            hoy: hoy,
            ejercicios: ejercicios >= 0 ? ejercicios : nil,
            hecho: disco.bool(forKey: "reloj.hecho"),
            comida: comida.isEmpty ? nil : comida,
            comidaHora: hora.isEmpty ? nil : hora,
            racha: disco.integer(forKey: "reloj.racha")
        )
    }
}

struct Entrada: TimelineEntry {
    let date: Date
    let resumen: Resumen
}

struct Proveedor: TimelineProvider {
    func placeholder(in context: Context) -> Entrada {
        Entrada(date: Date(), resumen: .vacio)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entrada) -> Void) {
        completion(Entrada(date: Date(), resumen: Resumen.leer()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entrada>) -> Void) {
        // Una sola entrada y `.never`: el dato no cambia con el tiempo, cambia
        // cuando el teléfono manda uno nuevo. Pedir refrescos por reloj
        // gastaría el presupuesto de actualizaciones del sistema para repintar
        // exactamente lo mismo.
        completion(Timeline(entries: [Entrada(date: Date(), resumen: Resumen.leer())], policy: .never))
    }
}

/// Qué toca hoy. La pregunta que la carátula puede contestar sin abrir nada.
struct HoyComplicacion: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "holygains.hoy", provider: Proveedor()) { entrada in
            VistaHoy(resumen: entrada.resumen)
                .containerBackground(for: .widget) { Color.clear }
        }
        .configurationDisplayName("Hoy toca")
        .description("El entrenamiento del día.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}

struct VistaHoy: View {
    @Environment(\.widgetFamily) private var familia
    let resumen: Resumen

    var body: some View {
        switch familia {
        case .accessoryInline:
            Text(resumen.hecho ? "\(resumen.hoy) ✓" : resumen.hoy)

        case .accessoryCircular:
            // En un círculo de 30 pt no cabe una palabra: cabe un símbolo y un
            // número. El check es la única información que importa cuando ya
            // entrenaste.
            VStack(spacing: 0) {
                Image(systemName: resumen.hecho ? "checkmark" : "dumbbell.fill")
                    .font(.system(size: 14, weight: .semibold))
                if let ejercicios = resumen.ejercicios, !resumen.hecho {
                    Text("\(ejercicios)")
                        .font(.system(size: 12, weight: .medium))
                }
            }

        default:
            VStack(alignment: .leading, spacing: 1) {
                Text(resumen.hoy)
                    .font(.headline)
                    .lineLimit(1)
                if resumen.hecho {
                    Text("Hecho")
                        .font(.caption2)
                } else if let ejercicios = resumen.ejercicios {
                    Text("\(ejercicios) ejercicios")
                        .font(.caption2)
                } else {
                    Text("Descanso")
                        .font(.caption2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - La siguiente comida

/// Un renglón de la comida (espejo de `SiguienteComidaReloj.Renglon` del target `watch`).
struct RenglonComida: Codable, Hashable {
    let display: String
    var platillo: Bool? = nil
    var enPlatillo: Bool? = nil
}

struct TomaComida: Codable, Hashable {
    let nombre: String
    let dosis: String
}

/// Una comida completa como la dejó escrita `Compartido.guardar(comida:)`.
struct ComidaGuardada: Codable {
    let nombre: String
    let hora: String
    let items: [RenglonComida]
    let tomas: [TomaComida]

    /// Alimentos y tomas en una sola lista, como se leen de corrido.
    var renglones: [String] {
        items.map(\.display) + tomas.map { "+ \($0.nombre) \($0.dosis)" }
    }

    /// Hoy a la `hora` ("21:00"); `nil` si no es una hora legible.
    func fecha(hoy: Date = Date()) -> Date? {
        let partes = hora.split(separator: ":").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard partes.count == 2 else { return nil }
        return Calendar.current.date(bySettingHour: partes[0], minute: partes[1], second: 0, of: hoy)
    }

    /// La comida que hay escrita: la completa si el teléfono ya la mandó, y
    /// si no, la del resumen (nombre, hora y los renglones que traiga).
    static func leer() -> (actual: ComidaGuardada?, luego: [ComidaGuardada]) {
        guard let disco = UserDefaults(suiteName: GRUPO) else { return (nil, []) }
        let nombre = disco.string(forKey: "reloj.comida") ?? ""
        guard !nombre.isEmpty else { return (nil, []) }

        let actual = ComidaGuardada(
            nombre: nombre,
            hora: disco.string(forKey: "reloj.comidaHora") ?? "",
            items: decodificar([RenglonComida].self, disco.string(forKey: "reloj.comidaItems")) ?? [],
            tomas: decodificar([TomaComida].self, disco.string(forKey: "reloj.comidaTomas")) ?? []
        )
        let luego = decodificar([ComidaGuardada].self, disco.string(forKey: "reloj.comidasLuego")) ?? []
        return (actual, luego)
    }

    private static func decodificar<T: Decodable>(_ tipo: T.Type, _ json: String?) -> T? {
        guard let data = json?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(tipo, from: data)
    }
}

/**
 Lo que cabe en `capacidad` renglones sin cortar callado: si no cabe todo, el
 último visible dice "+N más". Mismo criterio que el widget del teléfono.
 */
func recortarConAviso(_ renglones: [String], capacidad: Int) -> [String] {
    if renglones.count <= capacidad { return renglones }
    if capacidad <= 0 { return ["+\(renglones.count) más"] }
    let visibles = Array(renglones.prefix(capacidad - 1))
    return visibles + ["+\(renglones.count - visibles.count) más"]
}

struct EntradaComida: TimelineEntry {
    let date: Date
    let comida: ComidaGuardada?
}

/**
 Una entrada ahora y una más por cada comida que sigue hoy, que arranca
 media hora después de la hora de la anterior: a las 21:30 la carátula ya
 dice el desayuno de mañana… si el teléfono lo mandó en `luego`; si no, se
 queda la última hasta que llegue dato nuevo (la app recarga el timeline cada
 vez que guarda).
 */
struct ProveedorComida: TimelineProvider {
    static let margen: TimeInterval = 30 * 60

    func placeholder(in context: Context) -> EntradaComida {
        EntradaComida(
            date: Date(),
            comida: ComidaGuardada(
                nombre: "Cena",
                hora: "21:00",
                items: [RenglonComida(display: "Pavo — 120 g"), RenglonComida(display: "3 tortillas de maíz")],
                tomas: []
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (EntradaComida) -> Void) {
        completion(EntradaComida(date: Date(), comida: ComidaGuardada.leer().actual ?? placeholder(in: context).comida))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EntradaComida>) -> Void) {
        let ahora = Date()
        let (actual, luego) = ComidaGuardada.leer()
        var entradas = [EntradaComida(date: ahora, comida: actual)]

        var anterior = actual
        for siguiente in luego {
            guard let hora = anterior?.fecha(hoy: ahora) else { break }
            let desde = hora.addingTimeInterval(Self.margen)
            if desde > ahora { entradas.append(EntradaComida(date: desde, comida: siguiente)) }
            anterior = siguiente
        }

        // `.never`: el dato cambia cuando el teléfono manda uno nuevo, y ahí
        // la app del reloj llama a `reloadAllTimelines`.
        completion(Timeline(entries: entradas, policy: .never))
    }
}

/// La siguiente comida. Lo que hace que el plan se cumpla es acordarse a tiempo.
struct ComidaComplicacion: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "holygains.comida", provider: ProveedorComida()) { entrada in
            VistaComida(comida: entrada.comida)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(URL(string: "holygains://comida"))
        }
        .configurationDisplayName("Siguiente comida")
        .description("Qué te toca comer, con sus tomas.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}

struct VistaComida: View {
    @Environment(\.widgetFamily) private var familia
    let comida: ComidaGuardada?

    var body: some View {
        switch familia {
        case .accessoryInline:
            // "Cena 21:00 · pavo, tortillas…": el sistema pone los puntos
            // suspensivos donde se acabe la línea.
            Text(inline)

        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "fork.knife")
                        .font(.system(size: 12, weight: .semibold))
                    if let hora = comida?.hora, !hora.isEmpty {
                        Text(hora)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                    }
                }
                .padding(2)
            }

        default:
            VStack(alignment: .leading, spacing: 1) {
                if let comida {
                    Text(comida.hora.isEmpty ? comida.nombre : "\(comida.nombre) · \(comida.hora)")
                        .font(.headline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .widgetAccentable()
                    ForEach(Array(recortarConAviso(comida.renglones, capacidad: 3).enumerated()), id: \.offset) { _, renglon in
                        Text(renglon)
                            .font(.caption2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                } else {
                    Text("Sin comidas pendientes")
                        .font(.headline)
                        .lineLimit(1)
                    Text("Abre Holy Gains en el teléfono")
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var inline: String {
        guard let comida else { return "Sin comidas pendientes" }
        let cabeza = comida.hora.isEmpty ? comida.nombre : "\(comida.nombre) \(comida.hora)"
        let nombres = comida.items.filter { $0.enPlatillo != true }.map { primeraPalabra($0.display) }
        return nombres.isEmpty ? cabeza : "\(cabeza) · \(nombres.joined(separator: ", "))"
    }

    /// "Pavo — 120 g" → "pavo"; "3 tortillas de maíz" → "tortillas": en una
    /// línea sobre la hora solo cabe de qué se trata.
    private func primeraPalabra(_ display: String) -> String {
        let sinCantidad = display.components(separatedBy: " — ").first ?? display
        let palabras = sinCantidad.split(separator: " ").map(String.init)
        let palabra = palabras.first { $0.rangeOfCharacter(from: .decimalDigits) == nil } ?? sinCantidad
        return palabra.lowercased()
    }
}

@main
struct ComplicacionesHolyGains: WidgetBundle {
    var body: some Widget {
        HoyComplicacion()
        ComidaComplicacion()
    }
}
