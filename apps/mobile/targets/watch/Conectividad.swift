import Foundation
import WatchConnectivity

/**
 El puente con el teléfono.

 Va por `WatchConnectivity` y no por App Group: entre iOS y watchOS los
 sandboxes están separados, así que el truco que comparten la app y el widget
 aquí no sirve.

 Dos canales y cada uno para lo suyo:

 - **`applicationContext`** para la sesión que manda el teléfono. Solo importa
   el estado más reciente, y este canal reemplaza el anterior en vez de hacer
   cola: si llegan tres actualizaciones mientras el reloj está apagado, al
   despertar se recibe la buena y no las tres.
 - **`transferUserInfo`** para las series que cierra el reloj. Aquí sí importan
   todas y ninguna se puede perder, así que hacen cola y se entregan aunque el
   teléfono esté fuera de alcance en ese momento. Cerrar una serie en el sótano
   del gimnasio y que se pierda sería el peor error posible de esta app.
 */
final class Conectividad: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = Conectividad()

    @Published var sesion: SesionEnVivo?
    @Published var resumen: ResumenDelDia?
    /// La siguiente comida completa. `nil` hasta que el teléfono la mande
    /// (builds viejos del teléfono solo mandan el resumen).
    @Published var siguienteComida: SiguienteComidaReloj?
    /// La complicación pidió abrir la pantalla de comida (`holygains://comida`).
    @Published var abrirComida = false
    @Published var alcanzable = false
    /// El teléfono acaba de terminar la sesión ("Terminar aquí" o se cerró la
    /// última serie). La vista lo usa para enseñar "Sesión terminada" antes de
    /// volver a inicio — sin este aviso, `sesion` se ponía en `nil` de golpe y
    /// la pantalla saltaba directo a `esperando`, como si nada hubiera pasado.
    @Published var finalizadaPorTelefono = false

    private override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - Recibir del teléfono

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.alcanzable = session.isReachable
            self.aplicar(contexto: session.receivedApplicationContext)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.alcanzable = session.isReachable }
    }

    /// Mensaje directo del teléfono, con la app del reloj ya abierta.
    ///
    /// Es el camino que se usa a media sesión: `updateApplicationContext` solo
    /// se entrega cuando la app del reloj se activa, así que sin esto la serie
    /// que se cerraba en el teléfono no aparecía en la muñeca hasta salir y
    /// volver a entrar. Se procesa igual que el contexto — mismo formato,
    /// mismo camino— para que no haya dos verdades.
    func session(_ session: WCSession, didReceiveMessage mensaje: [String: Any]) {
        DispatchQueue.main.async { self.aplicar(contexto: mensaje) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext contexto: [String: Any]) {
        DispatchQueue.main.async { self.aplicar(contexto: contexto) }
    }

    /// El contexto trae las dos cosas por separado y cada una se aplica sola:
    /// un resumen mal formado no puede dejar sin sesión a quien está a media
    /// serie.
    ///
    /// Antes de eso se revisa si lo que llegó es el aviso de fin de sesión:
    /// `{"tipo": "fin"}` plano (por `sendMessage`, a media sesión) o
    /// `"sesion": "null"` dentro del contexto (el teléfono manda `nil` como
    /// sesión al terminar). Los dos caminos cierran igual.
    private func aplicar(contexto: [String: Any]) {
        if let tipo = contexto["tipo"] as? String, tipo == "fin" {
            finalizar()
            return
        }

        let decodificador = JSONDecoder()

        if let json = contexto["sesion"] as? String {
            if json == "null" {
                finalizar()
            } else if let data = json.data(using: .utf8),
                      let sesion = try? decodificador.decode(SesionEnVivo.self, from: data) {
                self.sesion = sesion
            }
        }

        if let json = contexto["resumen"] as? String,
           let data = json.data(using: .utf8),
           let resumen = try? decodificador.decode(ResumenDelDia.self, from: data) {
            self.resumen = resumen
            // La complicación es otro proceso y no ve esta propiedad: hay que
            // dejarle el dato por escrito.
            Compartido.guardar(resumen)
        }

        // Después del resumen a propósito: si llegan los dos, la comida
        // completa es la que queda escrita para la complicación.
        if let json = contexto["siguienteComida"] as? String {
            if json == "null" {
                siguienteComida = nil
                Compartido.guardar(comida: nil)
            } else if let data = json.data(using: .utf8),
                      let comida = try? decodificador.decode(SiguienteComidaReloj.self, from: data) {
                siguienteComida = comida
                Compartido.guardar(comida: comida)
            }
        }
    }

    /// El teléfono terminó la sesión. La vista se encarga de detener el
    /// entrenamiento y el contador; aquí solo se refleja el estado.
    private func finalizar() {
        sesion = nil
        finalizadaPorTelefono = true
    }

    // MARK: - Mandar al teléfono

    /// Cierra una serie y la manda. Se aplica en el reloj de inmediato: la
    /// pantalla no espera al teléfono para avanzar.
    func cerrar(serie: SerieCerrada) {
        var serie = serie
        guard var actual = sesion else { return }

        if actual.ejercicios.indices.contains(serie.ejercicioIndice),
           actual.ejercicios[serie.ejercicioIndice].series.indices.contains(serie.serieIndice) {
            actual.ejercicios[serie.ejercicioIndice].series[serie.serieIndice].hechas = serie.reps
            sesion = actual
        }

        guard WCSession.isSupported() else { return }

        let codificador = JSONEncoder()
        // Fechas en ISO 8601 y no en el número de segundos desde 2001, que es
        // lo que Swift hace por omisión y JavaScript no sabe leer.
        codificador.dateEncodingStrategy = .iso8601

        guard var data = try? codificador.encode(serie) else { return }

        // WatchConnectivity corta en 64 KB. Si la muestra de movimiento no
        // cabe, se va la serie sin ella: el registro del entrenamiento vale
        // mucho más que el dato de calibración.
        if data.count > 55_000 {
            serie.muestra = []
            guard let recortada = try? codificador.encode(serie) else { return }
            data = recortada
        }

        guard let json = String(data: data, encoding: .utf8) else { return }

        // Cola garantizada: llega aunque el teléfono esté fuera de alcance.
        WCSession.default.transferUserInfo(["serieCerrada": json])
    }

    /**
     Manda el pulso al teléfono mientras dura el descanso.

     Solo por `sendMessage`, nunca por cola: es una lectura que se repite cada
     pocos segundos, así que si esta se pierde porque el teléfono está fuera de
     alcance no pasa nada — la siguiente la reemplaza. Ponerla en
     `transferUserInfo` acumularía lecturas viejas en la cola para nada.
     */
    func mandarFC(bpm: Int) {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return }
        let mensaje: [String: Any] = [
            "tipo": "fc",
            "bpm": bpm,
            "t": Date().timeIntervalSince1970,
        ]
        WCSession.default.sendMessage(mensaje, replyHandler: nil, errorHandler: nil)
    }
}
