import { describe, expect, it, vi } from "vitest";

// `recordatorio.ts` importa `expo-notifications` a nivel de módulo; aquí solo
// se prueban sus funciones puras, así que el mock puede quedar vacío.
vi.mock("expo-notifications", () => ({
  default: {},
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  SchedulableTriggerInputTypes: { WEEKLY: "weekly", DAILY: "daily", TIME_INTERVAL: "timeInterval" },
}));

const { cuerpoPreparate, diaCodigoAWeekday, resumenMenu, sumaMinutosHora } = await import("@/lib/recordatorio");

/**
 * Las piezas puras del recordatorio en dos tiempos.
 *
 * Lo que se prueba aquí es la aritmética de horas y el mapeo de días — lo que
 * decide a qué hora exacta y en qué weekday de expo-notifications se dispara
 * cada aviso. El resto (`programarComidas`) llama a la API nativa de
 * notificaciones y se verifica a mano en el simulador, no aquí.
 */

describe("sumaMinutosHora", () => {
  it("resta minutos dentro del mismo día", () => {
    expect(sumaMinutosHora("14:30", -30)).toEqual({ hour: 14, minute: 0 });
  });

  it("suma minutos dentro del mismo día", () => {
    expect(sumaMinutosHora("14:30", 45)).toEqual({ hour: 15, minute: 15 });
  });

  it("envuelve hacia el día anterior sin romperse", () => {
    expect(sumaMinutosHora("00:10", -30)).toEqual({ hour: 23, minute: 40 });
  });

  it("envuelve hacia el día siguiente sin romperse", () => {
    expect(sumaMinutosHora("23:50", 45)).toEqual({ hour: 0, minute: 35 });
  });

  it("null si no es una hora", () => {
    expect(sumaMinutosHora("mañana", -30)).toBeNull();
  });
});

describe("diaCodigoAWeekday", () => {
  it("domingo es 1 y sábado es 7, como pide expo-notifications", () => {
    expect(diaCodigoAWeekday("DOM")).toBe(1);
    expect(diaCodigoAWeekday("LUN")).toBe(2);
    expect(diaCodigoAWeekday("SAB")).toBe(7);
  });

  it("un código que no existe no truena", () => {
    expect(diaCodigoAWeekday("XXX")).toBeUndefined();
  });
});

describe("resumenMenu", () => {
  it("usa display si existe, si no el name, máximo 4", () => {
    const items = [
      { name: "Pechuga de pollo", display: "Pechuga" },
      { name: "Arroz" },
      { name: "Brócoli" },
      { name: "Aguacate" },
      { name: "Tortilla" },
    ];
    expect(resumenMenu(items)).toBe("Pechuga, Arroz, Brócoli, Aguacate");
  });

  it("sin items regresa vacío", () => {
    expect(resumenMenu([])).toBe("");
  });
});

describe("cuerpoPreparate", () => {
  it("sin tomas es el menú de siempre", () => {
    expect(cuerpoPreparate([{ name: "Pollo" }, { name: "Arroz" }])).toBe("Pollo, Arroz");
    expect(cuerpoPreparate([])).toBe("Ya casi es hora de tu comida.");
  });

  it("con una toma amarrada a la comida suma \"+ omega-3\"", () => {
    expect(cuerpoPreparate([{ name: "Pollo" }], ["omega-3"])).toBe("Pollo + omega-3");
    expect(cuerpoPreparate([{ name: "Salmón" }], ["magnesio", "té de manzanilla"])).toBe(
      "Salmón + magnesio + té de manzanilla",
    );
  });
});
