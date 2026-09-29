import SwiftUI
import WatchKit

/**
 Holy Gains en la muñeca.

 Hace una sola cosa: enseñar en qué serie vas y dejar cerrarla sin sacar el
 teléfono. Es la mitad del valor de la sesión en vivo con una fracción de la
 fricción — entre serie y serie, mirar la muñeca cuesta un segundo y sacar el
 teléfono con las manos llenas de magnesio cuesta media serie.

 Mientras hay serie pendiente corre una `HKWorkoutSession` (ver
 `Entrenamiento.swift`). No es decorado: es lo que impide que watchOS suspenda
 la app en cuanto bajas el brazo, y de paso trae pulso y calorías y escribe el
 entrenamiento en Salud.

 Las repeticiones se cuentan solas cuando ya hay una serie de ese ejercicio
 cerrada a mano: de esa serie sale la calibración (ver `Contador.swift`), y a
 partir de ahí cada rep da un golpe en la muñeca, llegar al objetivo da otro y
 el fin del descanso otro más. La primera serie de cada ejercicio siempre es
 manual a propósito — es la que enseña cómo se mueve TU muñeca en ESE
 ejercicio.
 */
@main
struct HolyGainsWatchApp: App {
    var body: some Scene {
        WindowGroup {
            SesionView()
                // Tocar la complicación de comida abre `holygains://comida`:
                // la app va directo a "Siguiente comida" si no hay sesión.
                .onOpenURL { url in
                    if url.host == "comida" { Conectividad.shared.abrirComida = true }
                }
        }
    }
}

struct SesionView: View {
    @ObservedObject private var conectividad = Conectividad.shared
    @ObservedObject private var entrenamiento = Entrenamiento.shared
    @ObservedObject private var descanso = Descanso.shared
    @State private var reps: Double = 0
    /// Kilos de la serie que viene. Se confirma o corrige antes de empezar.
    /// SIEMPRE kilos por dentro: las libras son cómo se pinta, no cómo se
    /// guarda — igual que en el teléfono.
    @State private var peso: Double = 0
    /// El salto de los botones ±, en la unidad que se está viendo.
    @State private var paso: Double = 2.5
    /// Pintar el peso en libras (los discos de algunos gimnasios).
    @State private var enLibras = false
    /// `preparando`: confirmar reps y peso. `enSerie`: la barra en la mano.
    @State private var enSerie = false
    /// Contar las reps con los sensores. Se puede encender cuando ya hay una
    /// serie de ESTE ejercicio cerrada a mano — de ahi sale la calibracion.
    @State private var contarSolo = true
    @ObservedObject private var contador = Contador.shared
    @State private var grabando = false
    /// En qué ejercicio estaba la serie anterior, para saber si el cambio de
    /// serie merece descanso o es un cambio de máquina.
    @State private var ejercicioPrevio: Int?

    var body: some View {
        Group {
            // Primero el aviso del teléfono: si acaba de terminar la sesión,
            // no importa qué traiga `sesion` — ya se puso en `nil`, pero el
            // aviso merece su propia pantalla y no un salto directo a
            // `esperando`.
            if conectividad.finalizadaPorTelefono {
                terminadaPorTelefono
            } else if let sesion = conectividad.sesion, let pendiente = sesion.pendiente {
                enCurso(sesion: sesion, pendiente: pendiente)
            } else if conectividad.sesion != nil {
                terminada
            } else {
                esperando
            }
        }
        .onAppear { entrenamiento.pedirPermiso() }
    }

    // MARK: - Estados

    /**
     Fuera de la sesión.

     No dice "no hay nada": dice qué toca hoy, cuál es la siguiente comida y
     cómo va la racha. Es la diferencia entre una app que sirve una hora al día
     y una que se mira de reojo el resto.
     */
    private var esperando: some View {
        NavigationStack {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let resumen = conectividad.resumen {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Hoy")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(resumen.hoy)
                            .font(.headline)
                        if let ejercicios = resumen.ejercicios, !resumen.hecho {
                            Text("\(ejercicios) ejercicios")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        if resumen.hecho {
                            Label("Hecho", systemImage: "checkmark.circle.fill")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let comida = conectividad.siguienteComida {
                        Divider()
                        NavigationLink {
                            SiguienteComidaVista(comida: comida)
                        } label: {
                            avanceDeComida(nombre: comida.nombre, hora: comida.hora, renglones: comida.items.map(\.display) + comida.tomas.map { "+ \($0.nombre) \($0.dosis)" })
                        }
                        .buttonStyle(.plain)
                    } else if let comida = resumen.comida {
                        Divider()
                        avanceDeComida(nombre: comida, hora: resumen.comidaHora ?? "", renglones: resumen.comidaItems ?? [])
                    }

                    Divider()
                    Label("\(resumen.racha) días seguidos", systemImage: "flame.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Text("Tu sesión aparece aquí en cuanto la abras en el teléfono.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Sin datos todavía")
                        .font(.headline)
                    Text("Abre Holy Gains en el teléfono una vez y esto se llena solo.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationDestination(isPresented: $conectividad.abrirComida) {
            if let comida = conectividad.siguienteComida {
                SiguienteComidaVista(comida: comida)
            } else {
                Text("Abre Holy Gains en el teléfono para ver tu comida.")
                    .font(.caption2)
            }
        }
        }
        .onAppear {
            entrenamiento.terminar()
            descanso.saltar()
            contador.limpiar()
        }
    }

    /// El avance de la comida en la pantalla de inicio: nombre, hora y tres
    /// renglones; si hay más, "+N más" y la lista entera al tocar.
    private func avanceDeComida(nombre: String, hora: String, renglones: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Sigue")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(nombre)
                .font(.subheadline)
            if !hora.isEmpty {
                Text(hora)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(recortar(renglones, capacidad: 3).enumerated()), id: \.offset) { _, renglon in
                Text(renglon)
                    .font(.caption2)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func recortar(_ renglones: [String], capacidad: Int) -> [String] {
        if renglones.count <= capacidad { return renglones }
        return Array(renglones.prefix(capacidad - 1)) + ["+\(renglones.count - capacidad + 1) más"]
    }

    private var terminada: some View {
        VStack(spacing: 6) {
            Text("Sesión completa")
                .font(.headline)
            Text("Todas las series cerradas.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding()
        // Cerrar aquí y no al salir de la app: salir con la sesión de Salud
        // viva la dejaría corriendo hasta que el reloj se canse, gastando
        // batería y ensuciando el entrenamiento con media hora de nada.
        .onAppear {
            entrenamiento.terminar()
            descanso.saltar()
            // La calibración era de ESTA sesión: la próxima recalibra.
            contador.limpiar()
        }
    }

    /**
     El teléfono terminó la sesión de golpe ("Terminar aquí" o se acabó el
     último ejercicio con el reloj mirando otra pantalla).

     Se cierra igual que `terminada` —entrenamiento, descanso, contador— y
     además, a los 3 segundos, apaga el aviso para que la siguiente vez que
     `body` se evalúe caiga en `esperando` sin que nadie tenga que tocar nada.
     */
    private var terminadaPorTelefono: some View {
        VStack(spacing: 6) {
            Text("Sesión terminada")
                .font(.headline)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .padding()
        .onAppear {
            entrenamiento.terminar()
            descanso.saltar()
            contador.limpiar()
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                conectividad.finalizadaPorTelefono = false
            }
        }
    }

    private func enCurso(sesion: SesionEnVivo, pendiente: (ejercicio: Int, serie: Int)) -> some View {
        let ejercicio = sesion.ejercicios[pendiente.ejercicio]
        let serie = ejercicio.series[pendiente.serie]
        let avance = sesion.progreso

        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(ejercicio.nombre)
                    .font(.headline)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .truncationMode(.tail)

                Text("Serie \(pendiente.serie + 1) de \(ejercicio.series.count)\(serie.calentamiento ? " · calentamiento" : "")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .truncationMode(.tail)

                if let restante = descanso.restante {
                    descansando(restante: restante)
                } else {
                    capturaDeSerie(ejercicio: ejercicio, indiceEjercicio: pendiente.ejercicio, serie: serie) {
                        cerrar(sesion: sesion, pendiente: pendiente, serie: serie)
                    }
                }

                // En 45 mm cabe en una fila; en 41/40 mm se apila para que
                // nada se corte a la mitad — tres datos con símbolo pueden
                // pasar del ancho de la pantalla chica sin esto.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        resumenDeAvance(avance: avance)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        resumenDeAvance(avance: avance)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)

                if !conectividad.alcanzable {
                    Text("Sin el teléfono cerca: se guarda y se manda cuando vuelva.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                // Salida explícita: quien abandona a media sesión necesita
                // poder cerrar el entrenamiento de Salud, o se queda corriendo.
                if entrenamiento.activo {
                    Button(role: .destructive) {
                        entrenamiento.terminar()
                    } label: {
                        Text("Terminar entrenamiento")
                            .font(.caption2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            entrenamiento.empezar()
            preparar(serie: serie)
            ejercicioPrevio = pendiente.ejercicio
        }
        .onChange(of: pendiente.serie) { avanzar(a: pendiente, ejercicio: ejercicio, serie: serie) }
        .onChange(of: pendiente.ejercicio) { avanzar(a: pendiente, ejercicio: ejercicio, serie: serie) }
        // El teléfono recalcula el descanso por esfuerzo, pulso o RPE y
        // reenvía la sesión — sin que cambie la serie pendiente, así que los
        // dos `onChange` de arriba no se enteran. Si ya se está descansando,
        // se corre el fin por la diferencia; si no, no hace falta nada: la
        // próxima vez que arranque un descanso, `avanzar()` ya lee este valor.
        .onChange(of: ejercicio.descansoSeg) { anterior, nuevo in
            guard descanso.restante != nil, ejercicioPrevio == pendiente.ejercicio else { return }
            descanso.sumar(nuevo - anterior)
        }
        // Cada ~5 s durante el descanso, para que el teléfono sepa cómo vas
        // bajando el pulso sin que nadie tenga que mirar el reloj y avisar.
        .onReceive(Timer.publish(every: 5, on: .main, in: .common).autoconnect()) { _ in
            guard descanso.restante != nil, let pulso = entrenamiento.pulso else { return }
            conectividad.mandarFC(bpm: pulso)
        }
    }

    /// Los tres datos del avance, en el orden que sea — HStack o VStack los
    /// pintan igual porque cada uno ya es una fila completa (`Label` incluye
    /// su texto e ícono juntos).
    @ViewBuilder
    private func resumenDeAvance(avance: (hechas: Int, total: Int)) -> some View {
        Text("\(avance.hechas)/\(avance.total) series")
            .lineLimit(1)
        if let pulso = entrenamiento.pulso {
            Label("\(pulso)", systemImage: "heart.fill")
                .lineLimit(1)
        }
        if let kcal = entrenamiento.kcal {
            Label("\(kcal)", systemImage: "flame.fill")
                .lineLimit(1)
        }
    }

    // MARK: - Subvistas

    /**
     La captura, en dos pasos.

     **Preparando**: confirmar (o corregir con la corona) las reps que pide el
     plan y el peso, y darle "Empezar". **En serie**: si el conteo automático
     está encendido, el número crece solo con un golpe por repetición; si no,
     el número es el objetivo y se corrige al cerrar. El paso de preparar
     existe porque la queja real fue al revés: cerrar series sin peso porque no
     había dónde ponerlo a tiempo.
     */
    @ViewBuilder
    private func capturaDeSerie(
        ejercicio: EjercicioEnVivo,
        indiceEjercicio: Int,
        serie: SerieEnVivo,
        alCerrar: @escaping () -> Void
    ) -> some View {
        if !enSerie {
            // Paso 1 — confirmar reps y peso.
            HStack {
                Button { reps = max(0, reps - 1) } label: { Image(systemName: "minus") }
                    .buttonStyle(.bordered)

                Text("\(Int(reps))")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .focusable()
                    .digitalCrownRotation($reps, from: 0, through: 100, by: 1, sensitivity: .low, isContinuous: false)

                Button { reps += 1 } label: { Image(systemName: "plus") }
                    .buttonStyle(.bordered)
            }
            Text("repeticiones")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            HStack {
                Button { ajustarPeso(-paso) } label: { Image(systemName: "minus") }
                    .buttonStyle(.bordered)

                // Peso de 3 dígitos en lb (p.ej. "225") sigue cabiendo gracias
                // al `minimumScaleFactor`: sin él, un peso pesado en la unidad
                // que estira más el texto se cortaba contra los botones.
                Text(pesoPintado)
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)

                Button { ajustarPeso(paso) } label: { Image(systemName: "plus") }
                    .buttonStyle(.bordered)
            }

            // El salto y la unidad, en una sola fila cuando cabe (45 mm); en
            // 41/40 mm se parte en dos filas — cuatro botones en una sola fila
            // angosta terminaban encimados o con el texto cortado.
            ViewThatFits(in: .horizontal) {
                pasoYUnidad
                VStack(spacing: 3) {
                    HStack(spacing: 3) { pasoChips }
                    HStack(spacing: 3) { botonUnidad }
                }
            }

            if contador.calibrado(indiceEjercicio) {
                Toggle(isOn: $contarSolo) {
                    Text("Contar reps solo")
                        .font(.caption2)
                }
                .tint(.green)
            } else {
                Text("Cierra esta serie a mano y las que siguen se cuentan solas.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Button {
                empezarSerie(indiceEjercicio: indiceEjercicio)
            } label: {
                Label("Empezar", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        } else {
            // Paso 2 — la serie corriendo.
            let automatico = contarSolo && contador.calibrado(indiceEjercicio)

            Text(automatico ? "\(contador.reps)" : "\(Int(reps))")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .focusable()
                .digitalCrownRotation($reps, from: 0, through: 100, by: 1, sensitivity: .low, isContinuous: false)

            Text(automatico ? "contando · objetivo \(serie.objetivo)" : "objetivo \(serie.objetivo) reps")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .truncationMode(.tail)

            Button(action: alCerrar) {
                Label("Serie hecha", systemImage: "checkmark")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    /// Los chips de paso (±.5 / ±1 / ±2.5) — piezas sueltas para poder
    /// pintarlos en una fila (45 mm) o en dos (41/40 mm) sin repetir código.
    @ViewBuilder
    private var pasoChips: some View {
        ForEach([0.5, 1.0, 2.5], id: \.self) { opcion in
            Button {
                paso = opcion
            } label: {
                Text(opcion == 0.5 ? "±.5" : String(format: "±%.0f", opcion))
                    .font(.system(size: 11, weight: paso == opcion ? .bold : .regular))
                    .lineLimit(1)
            }
            .buttonStyle(.bordered)
            .tint(paso == opcion ? .green : .gray)
        }
    }

    /// El botón kg/lb, suelto por la misma razón que `pasoChips`.
    @ViewBuilder
    private var botonUnidad: some View {
        Button {
            enLibras.toggle()
        } label: {
            Text(enLibras ? "lb" : "kg")
                .font(.system(size: 11, weight: .bold))
                .lineLimit(1)
        }
        .buttonStyle(.bordered)
        .tint(.orange)
    }

    /// El salto y la unidad en una sola fila (45 mm y más anchas).
    private var pasoYUnidad: some View {
        HStack(spacing: 3) {
            pasoChips
            botonUnidad
        }
    }

    /// El descanso, que ocupa el lugar del contador mientras corre.
    @ViewBuilder
    private func descansando(restante: Int) -> some View {
        Text(Descanso.formato(restante))
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .frame(maxWidth: .infinity)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .monospacedDigit()

        Text("de descanso")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)

        // El peso de la SIGUIENTE serie, ajustable aquí mismo — es el rato en
        // que sí hay tiempo de pensarlo, a diferencia de "Empezar" que llega
        // con la barra ya en la mano. `peso` es el mismo estado que "Paso 1"
        // va a mostrar después y el que viaja al teléfono cuando esa serie se
        // cierre (`SerieCerrada.pesoKg`): no hace falta un mensaje nuevo.
        VStack(spacing: 2) {
            Text("Siguiente: \(pesoPintado) \(enLibras ? "lb" : "kg")")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .truncationMode(.tail)

            HStack {
                Button { ajustarPeso(-paso) } label: { Image(systemName: "minus") }
                    .buttonStyle(.bordered)
                Text(pesoPintado)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Button { ajustarPeso(paso) } label: { Image(systemName: "plus") }
                    .buttonStyle(.bordered)
            }
        }

        HStack {
            Button("+30 s") { descanso.sumar(30) }
                .buttonStyle(.bordered)
            Button("Ya estoy") { descanso.saltar() }
                .buttonStyle(.borderedProminent)
        }
        .font(.caption2)
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }

    // MARK: - Acciones

    /**
     Se pasó a la siguiente serie —la haya cerrado el reloj o el teléfono—.

     El descanso arranca aquí y no al tocar el botón, para que dé igual dónde
     se cerró la serie: cerrarla en el teléfono también debe poner el
     cronómetro en la muñeca, que es donde se va a mirar.
     */
    private func avanzar(
        a pendiente: (ejercicio: Int, serie: Int),
        ejercicio: EjercicioEnVivo,
        serie: SerieEnVivo
    ) {
        let mismoEjercicio = ejercicioPrevio == pendiente.ejercicio
        ejercicioPrevio = pendiente.ejercicio

        preparar(serie: serie)

        if mismoEjercicio {
            descanso.arrancar(segundos: ejercicio.descansoSeg)
        } else {
            // Cambio de máquina: el traslado ya es el descanso.
            descanso.saltar()
        }
    }

    /// El peso como se lee: en la unidad elegida, sin decimales de sobra.
    private var pesoPintado: String {
        guard peso > 0 else { return "—" }
        let mostrado = enLibras ? peso * 2.2046226218 : peso
        let redondeado = (mostrado * 10).rounded() / 10
        return redondeado.truncatingRemainder(dividingBy: 1) == 0
            ? String(format: "%.0f", redondeado)
            : String(format: "%.1f", redondeado)
    }

    /**
     Suma el paso EN LA UNIDAD que se está viendo y guarda kilos.

     La suma va sobre lo pintado —si subes de 135 a 140 lb quieres 140
     exactas— y se cuadra al múltiplo del paso, igual que en el teléfono.
     */
    private func ajustarPeso(_ delta: Double) {
        let factor = enLibras ? 2.2046226218 : 1.0
        let mostrado = peso * factor
        let siguiente = ((mostrado + delta) / abs(delta)).rounded() * abs(delta)
        peso = max(0, siguiente) / factor
    }

    /**
     Cada serie arranca con lo del plan puesto: reps objetivo y peso sugerido.
     Escribir desde cero es la fricción que hace que nadie registre.

     La grabación de movimiento YA NO arranca aquí sino en `empezarSerie`: si
     graba desde que la pantalla pinta, la calibración del conteo se
     contamina con el descanso y el caminar entre máquinas.
     */
    private func preparar(serie: SerieEnVivo) {
        reps = Double(serie.objetivo)
        peso = serie.pesoKg ?? peso
        enSerie = false
    }

    /// "Empezar": desde aquí lo que se mueve la muñeca ES la serie.
    private func empezarSerie(indiceEjercicio: Int) {
        WKInterfaceDevice.current().play(.start)
        Movimiento.shared.empezar()
        grabando = true
        if contarSolo && contador.calibrado(indiceEjercicio) {
            contador.empezar(ejercicio: indiceEjercicio, objetivo: Int(reps))
        }
        enSerie = true
    }

    private func cerrar(sesion: SesionEnVivo, pendiente: (ejercicio: Int, serie: Int), serie: SerieEnVivo) {
        let automatico = contarSolo && contador.calibrado(pendiente.ejercicio)
        let contadas = contador.detener()
        let grabado = Movimiento.shared.detener()
        grabando = false
        enSerie = false

        // Con el conteo encendido mandan las contadas; a mano, lo de la
        // corona. Y una serie manual con grabación decente ES la calibración
        // del ejercicio: a partir de ella, las siguientes se cuentan solas.
        let repsFinales = automatico ? max(contadas, 1) : Int(reps)
        if !automatico {
            contador.calibrar(
                ejercicio: pendiente.ejercicio,
                muestra: grabado.muestra,
                reps: repsFinales,
                duracion: grabado.duracion
            )
        }

        WKInterfaceDevice.current().play(.success)

        // La última lectura de pulso de la serie, antes de que arranque el
        // descanso (o el próximo timer de 5 s la reemplace).
        if let pulso = entrenamiento.pulso {
            conectividad.mandarFC(bpm: pulso)
        }

        conectividad.cerrar(
            serie: SerieCerrada(
                workoutId: sesion.workoutId,
                ejercicioIndice: pendiente.ejercicio,
                serieIndice: pendiente.serie,
                reps: repsFinales,
                pesoKg: peso > 0 ? peso : serie.pesoKg,
                cerradaEn: Date(),
                muestra: grabado.muestra,
                duracionSeg: grabado.duracion
            )
        )
    }
}
