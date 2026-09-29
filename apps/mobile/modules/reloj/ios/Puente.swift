import Foundation
import WatchConnectivity

/**
 El lado del teléfono de la conversación con el reloj.

 Vive fuera del módulo de Expo por una razón concreta: `WCSession` tiene un
 solo delegado por proceso y iOS puede despertar la app en segundo plano para
 entregar lo que el reloj mandó, con el motor de JavaScript todavía apagado. Si
 el delegado fuera el módulo, ese mensaje se perdería. Aquí es un singleton que
 existe desde que arranca el proceso y **guarda en disco** lo que llega; la
 pantalla lo recoge cuando despierta.

 Dos canales, cada uno para lo suyo:

 - **`updateApplicationContext`** para mandar la sesión y el resumen del día al
   reloj. Solo importa el estado más reciente; si se pierden tres
   actualizaciones intermedias porque el reloj estaba fuera de rango, da igual
   — la que llega es la buena.

   Este canal **reemplaza** el contexto entero, no lo mezcla: mandar solo la
   sesión borraría el resumen y al revés. Por eso los dos últimos valores se
   guardan aquí y cada envío manda ambos.
 - **`transferUserInfo`** para recibir las series cerradas. Aquí sí importa
   cada una: una serie cerrada que se pierde es trabajo que el usuario hizo y
   la app no registró. Esta cola iOS la garantiza y la reintenta sola.
 */
final class Puente: NSObject {
  static let compartido = Puente()

  /// Se avisa cuando llegó algo nuevo. No lleva los datos: quien escuche debe
  /// llamar a `drenar()`, para que haya una sola fuente de verdad y nada se
  /// entregue dos veces.
  var alLlegarSerie: (() -> Void)?

  /// El pulso que manda el reloj durante el descanso: `{tipo: "fc", bpm, t}`.
  var alLlegarFrecuencia: ((Double, Double) -> Void)?

  private let llaveBuzon = "reloj.seriesCerradas"

  /// Lo último que se mandó de cada cosa, para poder remandarlo junto.
  private var ultimaSesion: String?
  private var ultimoResumen: String?
  /// La siguiente comida completa (JSON de `siguienteComida` + `luego`).
  private var ultimaComida: String?

  func activar() {
    guard WCSession.isSupported() else { return }
    let sesion = WCSession.default
    sesion.delegate = self
    sesion.activate()
  }

  func estado() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["soportado": false, "emparejado": false, "appInstalada": false, "alcanzable": false]
    }
    let sesion = WCSession.default
    return [
      "soportado": true,
      "emparejado": sesion.isPaired,
      "appInstalada": sesion.isWatchAppInstalled,
      "alcanzable": sesion.isReachable,
    ]
  }

  /// Manda el estado de la sesión al reloj. `false` si no hay a quién mandarle.
  @discardableResult
  func enviarSesion(_ json: String) -> Bool {
    ultimaSesion = json
    return empujar()
  }

  /// Manda el resumen del día (qué toca, siguiente comida, racha).
  @discardableResult
  func enviarResumen(_ json: String) -> Bool {
    ultimoResumen = json
    return empujar()
  }

  /// Manda la siguiente comida completa, con todos sus renglones y tomas.
  @discardableResult
  func enviarSiguienteComida(_ json: String) -> Bool {
    ultimaComida = json
    return empujar()
  }

  /**
   Manda lo que haya. `false` si en este momento no hay a quién mandarle.

   Ese `false` **no** pierde el dato: lo último de cada cosa se queda guardado
   arriba y se vuelve a empujar en cuanto la sesión se activa o el reloj
   aparece. Sin eso había una carrera silenciosa y muy fácil de tener: al
   arrancar en frío, `activate()` tarda, la pantalla de Hoy carga antes, manda
   el resumen contra una sesión todavía no activada y ese resumen no llegaba
   nunca — el reloj se quedaba en blanco hasta el siguiente arranque.
   */
  @discardableResult
  private func empujar() -> Bool {
    guard WCSession.isSupported() else { return false }
    let sesion = WCSession.default
    guard sesion.activationState == .activated, sesion.isPaired, sesion.isWatchAppInstalled else {
      return false
    }

    var contexto: [String: Any] = [:]
    if let ultimaSesion { contexto["sesion"] = ultimaSesion }
    if let ultimoResumen { contexto["resumen"] = ultimoResumen }
    if let ultimaComida { contexto["siguienteComida"] = ultimaComida }
    guard !contexto.isEmpty else { return false }

    // Mensaje directo cuando el reloj está al alcance Y con la app abierta:
    // `updateApplicationContext` solo se entrega cuando la app del reloj se
    // activa, así que a media sesión —con la app YA abierta en la muñeca— el
    // contexto se quedaba en la cola y no llegaba nada hasta salir y volver a
    // entrar. Es el caso que se usa en el gimnasio, y el que no funcionaba.
    if sesion.isReachable {
      sesion.sendMessage(contexto, replyHandler: nil, errorHandler: nil)
    }

    // El contexto se manda SIEMPRE, también cuando ya se mandó el mensaje: es
    // lo que hace que el reloj encuentre el estado al día si la app se abre
    // más tarde, o si el mensaje se perdió.
    do {
      try sesion.updateApplicationContext(contexto)
      return true
    } catch {
      // Si el contexto falla pero el mensaje salió, la sesión SÍ llegó.
      return sesion.isReachable
    }
  }

  /**
   La sesión terminó en el teléfono: `{tipo: "fin"}` al reloj.

   Por `sendMessage` si la app de la muñeca está abierta (llega al instante) y
   también en el contexto, para el reloj que estaba fuera de alcance. La
   sesión guardada se olvida: remandarla con el siguiente resumen le
   devolvería al reloj una sesión que ya se cerró.
   */
  @discardableResult
  func enviarFin() -> Bool {
    ultimaSesion = nil
    guard WCSession.isSupported() else { return false }
    let sesion = WCSession.default
    guard sesion.activationState == .activated, sesion.isPaired, sesion.isWatchAppInstalled else {
      return false
    }

    if sesion.isReachable {
      sesion.sendMessage(["tipo": "fin"], replyHandler: nil, errorHandler: nil)
    }

    var contexto: [String: Any] = ["tipo": "fin"]
    if let ultimoResumen { contexto["resumen"] = ultimoResumen }
    if let ultimaComida { contexto["siguienteComida"] = ultimaComida }
    do {
      try sesion.updateApplicationContext(contexto)
      return true
    } catch {
      return sesion.isReachable
    }
  }

  private func recibir(_ mensaje: [String: Any]) {
    guard let tipo = mensaje["tipo"] as? String, tipo == "fc" else { return }
    guard let bpm = (mensaje["bpm"] as? NSNumber)?.doubleValue else { return }
    let t = (mensaje["t"] as? NSNumber)?.doubleValue ?? Date().timeIntervalSince1970
    DispatchQueue.main.async { [weak self] in self?.alLlegarFrecuencia?(bpm, t) }
  }

  /// Devuelve lo que el reloj mandó y vacía el buzón.
  func drenar() -> [String] {
    let buzon = UserDefaults.standard.stringArray(forKey: llaveBuzon) ?? []
    if !buzon.isEmpty {
      UserDefaults.standard.removeObject(forKey: llaveBuzon)
    }
    return buzon
  }

  private func guardar(_ json: String) {
    var buzon = UserDefaults.standard.stringArray(forKey: llaveBuzon) ?? []
    buzon.append(json)
    UserDefaults.standard.set(buzon, forKey: llaveBuzon)
    DispatchQueue.main.async { [weak self] in self?.alLlegarSerie?() }
  }
}

extension Puente: WCSessionDelegate {
  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    // Lo que se intentó mandar antes de que la sesión estuviera lista sale
    // ahora.
    empujar()
  }

  /// El reloj se emparejó, o le acaban de instalar la app.
  func sessionWatchStateDidChange(_ session: WCSession) {
    empujar()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    empujar()
  }

  // Las dos de abajo son obligatorias en iOS aunque no haya varios relojes:
  // sin ellas no compila. Al desactivarse hay que reactivar para seguir
  // hablando con el reloj que quedó emparejado.
  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }

  /// Mensajes en vivo del reloj (hoy: el pulso del descanso).
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    recibir(message)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    recibir(message)
    replyHandler([:])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard let json = userInfo["serieCerrada"] as? String else { return }
    guardar(json)
  }
}
