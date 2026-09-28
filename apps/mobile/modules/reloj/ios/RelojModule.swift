import ExpoModulesCore

/**
 El módulo que JavaScript ve.

 Fino a propósito: todo lo que puede pasar con la app dormida vive en `Puente`.
 Aquí solo se traduce entre Swift y JavaScript, y se pasan cadenas JSON en vez
 de objetos porque la forma de la sesión la define TypeScript y no vale la pena
 repetirla en un `Record` de Swift que habría que actualizar cada vez.
 */
public class RelojModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Reloj")

    Events("onSerieCerrada", "onFrecuencia")

    OnCreate {
      Puente.compartido.activar()
      Puente.compartido.alLlegarSerie = { [weak self] in
        self?.sendEvent("onSerieCerrada", [:])
      }
      // El pulso del descanso llega en vivo y no se guarda: si nadie escucha,
      // la siguiente lectura (5 s después) lo reemplaza.
      Puente.compartido.alLlegarFrecuencia = { [weak self] bpm, t in
        self?.sendEvent("onFrecuencia", ["bpm": bpm, "t": t])
      }
    }

    Function("estado") { () -> [String: Any] in
      Puente.compartido.estado()
    }

    Function("enviarSesion") { (json: String) -> Bool in
      Puente.compartido.enviarSesion(json)
    }

    Function("enviarResumen") { (json: String) -> Bool in
      Puente.compartido.enviarResumen(json)
    }

    Function("drenar") { () -> [String] in
      Puente.compartido.drenar()
    }

    Function("enviarFin") { () -> Bool in
      Puente.compartido.enviarFin()
    }
  }
}
