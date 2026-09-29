import SwiftUI
import WidgetKit

/**
 * Widget 3 — Tu siguiente comida. Nombre del tiempo (Pre-entreno / Comida /
 * Cena…), su hora, TODOS sus alimentos y, al final, las tomas amarradas a esa
 * comida ("+ Ashwagandha 300 mg"). La app ya elige el tiempo correcto
 * (`siguienteComida` en `src/lib/siguiente-comida.ts`) — el widget solo pinta.
 *
 * Antes pintaba `prefix(3)`: la cena de cuatro alimentos perdía el cuarto y
 * la ashwagandha no salía nunca. Ahora pinta los que quepan en el tamaño y,
 * si alguno no cabe, el último renglón dice "+N más": nunca corta callado.
 *
 * Tamaños: pequeño, mediano y grande en la pantalla de inicio, y rectángulo en
 * la pantalla de bloqueo.
 */

struct MealEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
}

struct MealProvider: TimelineProvider {
    func placeholder(in context: Context) -> MealEntry {
        MealEntry(date: Date(), data: WidgetData.load())
    }

    func getSnapshot(in context: Context, completion: @escaping (MealEntry) -> Void) {
        completion(MealEntry(date: Date(), data: WidgetData.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MealEntry>) -> Void) {
        let entry = MealEntry(date: Date(), data: WidgetData.load())
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct MealWidgetView: View {
    @Environment(\.widgetFamily) private var familia
    let entry: MealEntry

    var body: some View {
        let data = entry.data
        if familia == .accessoryRectangular {
            bloqueo(data)
        } else if let label = data.comidaLabel {
            VStack(alignment: .leading, spacing: 8) {
                EyebrowLabel(text: "Tu siguiente comida")

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(label)
                        .font(.system(.title3, design: .serif))
                        .foregroundStyle(HGColor.marfil)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)

                    if let hora = data.comidaHora {
                        Text(hora)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(HGColor.champan)
                            .lineLimit(1)
                    }
                }

                // De la lista completa a ninguna: `ViewThatFits` se queda con
                // la primera que cabe en el alto que deja este tamaño. Las
                // tomas van siempre; lo que se sacrifica son alimentos, y lo
                // que no cupo se cuenta en "+N más".
                ViewThatFits(in: .vertical) {
                    ForEach(Array(stride(from: data.comidaRenglones.count, through: 0, by: -1)), id: \.self) { visibles in
                        lista(data, visibles: visibles)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .topLeading)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(HGColor.obsidiana, for: .widget)
        } else {
            EmptyWidgetView(message: "Abre Holy Gains para ver tu siguiente comida")
        }
    }

    /// Los primeros `visibles` renglones, "+N más" si faltan, y las tomas.
    private func lista(_ data: WidgetData, visibles: Int) -> some View {
        let renglones = data.comidaRenglones
        let faltan = renglones.count - visibles

        return VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(renglones.prefix(visibles).enumerated()), id: \.offset) { _, renglon in
                Text("· \(renglon.display)")
                    .font(.system(size: 12, weight: renglon.platillo == true ? .semibold : .regular))
                    .foregroundStyle(HGColor.paloRosaLight)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.leading, renglon.enPlatillo == true ? 10 : 0)
            }

            if faltan > 0 {
                Text("+\(faltan) más")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(HGColor.paloRosa)
                    .lineLimit(1)
            }

            ForEach(data.comidaTomas, id: \.self) { toma in
                Text(toma)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(HGColor.champan)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
        }
    }

    /// Pantalla de bloqueo: sin color (iOS la pinta en blanco y negro), la
    /// comida y su hora arriba y dos renglones; si no caben, "+N más".
    @ViewBuilder
    private func bloqueo(_ data: WidgetData) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            if let label = data.comidaLabel {
                Text(data.comidaHora.map { "\(label) · \($0)" } ?? label)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .widgetAccentable()
                ForEach(recortarConAviso(data.comidaRenglones.map(\.display) + data.comidaTomas, capacidad: 2), id: \.self) { renglon in
                    Text(renglon)
                        .font(.caption2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            } else {
                Text("Tu siguiente comida")
                    .font(.headline)
                Text("Abre Holy Gains")
                    .font(.caption2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(.clear, for: .widget)
    }
}

struct MealWidget: Widget {
    let kind: String = "meal_widget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MealProvider()) { entry in
            MealWidgetView(entry: entry)
                .widgetURL(URL(string: "holygains://nutricion"))
        }
        .configurationDisplayName("Tu siguiente comida")
        .description("El próximo tiempo de comida de tu menú.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}
