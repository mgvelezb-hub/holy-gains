import { describe, expect, it } from "vitest";

import { conTipoLeche, sinMarcaDeLeche, tipoLecheDe } from "@/lib/coachy/leche";

describe("tipo de leche guardado en los excluidos", () => {
  it("sin marca, descremada", () => {
    expect(tipoLecheDe(["atún", "licuados"])).toBe("descremada");
  });

  it("lee la marca leche:<tipo> sin importar mayúsculas ni espacios", () => {
    expect(tipoLecheDe(["atún", " Leche:Deslactosada_Light "])).toBe("deslactosada_light");
    expect(tipoLecheDe(["leche:entera"])).toBe("entera");
  });

  it("una marca que no es un tipo se ignora", () => {
    expect(tipoLecheDe(["leche:de almendra"])).toBe("descremada");
  });

  it("cambiar la leche reemplaza la marca sin tocar lo demás; descremada no deja marca", () => {
    const entera = conTipoLeche(["atún", "licuados", "leche:deslactosada"], "entera");
    expect(entera).toEqual(["atún", "licuados", "leche:entera"]);
    expect(conTipoLeche(entera, "descremada")).toEqual(["atún", "licuados"]);
  });

  it("al motor y a la pantalla les llegan los excluidos sin la marca", () => {
    // "leche:entera" contiene "leche": el motor la leería como excluir TODAS las leches.
    expect(sinMarcaDeLeche(["atún", "leche:entera", "leche"])).toEqual(["atún", "leche"]);
  });
});

import type { Profile } from "@prisma/client";
import { toEngineProfile } from "@/lib/coachy/mapping";

describe("toEngineProfile traduce la marca de leche", () => {
  const base = {
    sex: "MALE",
    birthDate: null,
    ageYears: 38,
    heightCm: 182,
    weightKg: 120,
    leanMassKg: null,
    liftingDays: 5,
    cardioMinWk: 90,
    work: "SEDENTARIO",
    mealsPerDay: 4,
    trainingTime: "MANANA",
    budget: "MEDIO",
    favoriteFoods: [],
    pantry: [],
    allergies: [],
    conditions: [],
    maxPrepMin: null,
    dietStyle: "ESTANDAR",
    supplements: [],
    fastingStartHour: null,
    fastingEndHour: null,
  };

  it("la marca entra como tipoLeche y no como alimento excluido", () => {
    const perfil = toEngineProfile({ ...base, excludedFoods: ["atún", "leche:entera"] } as unknown as Profile);
    expect(perfil.tipoLeche).toBe("entera");
    expect(perfil.excludedFoods).toEqual(["atún"]);
  });

  it("sin marca, descremada", () => {
    const perfil = toEngineProfile({ ...base, excludedFoods: [] } as unknown as Profile);
    expect(perfil.tipoLeche).toBe("descremada");
  });
});

import { baseLicuadoDe, conBaseLicuado } from "@/lib/coachy/leche";

describe("base de licuados guardada en los excluidos", () => {
  it("sin marca, leche", () => {
    expect(baseLicuadoDe(["atún", "leche:entera"])).toBe("leche");
  });

  it("la marca base:agua dice agua, sin importar mayúsculas", () => {
    expect(baseLicuadoDe([" Base:Agua "])).toBe("agua");
  });

  it("cambiar la base no toca la leche ni lo demás; leche no deja marca", () => {
    const agua = conBaseLicuado(["atún", "leche:entera"], "agua");
    expect(agua).toEqual(["atún", "leche:entera", "base:agua"]);
    expect(conBaseLicuado(agua, "leche")).toEqual(["atún", "leche:entera"]);
  });

  it("cambiar la leche conserva la base", () => {
    expect(conTipoLeche(["base:agua", "leche:entera"], "deslactosada")).toEqual(["base:agua", "leche:deslactosada"]);
  });

  it("al motor y a la pantalla no les llega la marca: 'base:agua' contiene 'agua'", () => {
    expect(sinMarcaDeLeche(["atún", "base:agua", "leche:entera"])).toEqual(["atún"]);
  });
});

describe("toEngineProfile traduce la base de licuados", () => {
  const base = {
    sex: "FEMALE", birthDate: null, ageYears: 34, heightCm: 160, weightKg: 62, leanMassKg: null,
    liftingDays: 6, cardioMinWk: 120, work: "ACTIVO", mealsPerDay: 5, trainingTime: "MANANA", budget: "MEDIO",
    favoriteFoods: [], pantry: [], allergies: [], conditions: [], maxPrepMin: 20, dietStyle: "ESTANDAR",
    supplements: [], fastingStartHour: null, fastingEndHour: null,
  };

  it("base:agua entra como baseLicuado y no excluye el agua", () => {
    const perfil = toEngineProfile({ ...base, excludedFoods: ["base:agua"] } as unknown as Profile);
    expect(perfil.baseLicuado).toBe("agua");
    expect(perfil.excludedFoods).toEqual([]);
  });

  it("sin marca, leche", () => {
    expect(toEngineProfile({ ...base, excludedFoods: [] } as unknown as Profile).baseLicuado).toBe("leche");
  });
});
