import SwiftUI

/**
 "Siguiente comida", en la muñeca: la lista COMPLETA y las tomas, desplazable
 con la corona.

 Es la respuesta a "¿qué me toca?" sin sacar el teléfono: la complicación da
 el avance (dos o tres renglones con "+N más") y tocarla trae aquí, donde no
 se corta nada — el platillo con sus ingredientes sangrados, lo suelto y, al
 final, "+ Ashwagandha 300 mg".
 */
struct SiguienteComidaVista: View {
    let comida: SiguienteComidaReloj

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text(comida.nombre)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                if !comida.hora.isEmpty {
                    Text(comida.hora)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Divider()

                ForEach(Array(comida.items.enumerated()), id: \.offset) { _, renglon in
                    Text(renglon.display)
                        .font(.caption2.weight(renglon.platillo == true ? .semibold : .regular))
                        .padding(.leading, renglon.enPlatillo == true ? 8 : 0)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !comida.tomas.isEmpty {
                    Divider()
                    ForEach(comida.tomas, id: \.self) { toma in
                        Text("+ \(toma.nombre) \(toma.dosis)")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.tint)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
        .navigationTitle("Siguiente comida")
    }
}
