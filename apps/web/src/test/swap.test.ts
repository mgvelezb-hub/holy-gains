import { describe, expect, it } from "vitest";

import { SwapError, applySwap } from "@/lib/coachy/swap";

/** Un menú mínimo de una sola comida, con Avena↔Amaranto como equivalencia. */
function mealsJsonDeAvena() {
  return [
    {
      slot: "desayuno",
      label: "Desayuno",
      timeHint: "7:00 am",
      allowDenseCarb: true,
      items: [
        { name: "Avena", grams: 60, free: false },
        { name: "Huevo", grams: 100, free: false },
      ],
      equivalences: [
        {
          forName: "Avena",
          options: [
            { name: "Amaranto", grams: 55 },
            { name: "Pan integral", grams: 70 },
          ],
        },
      ],
    },
  ];
}

function equivalencesJsonDeAvena() {
  return [
    {
      slot: "desayuno",
      forName: "Avena",
      options: [
        { name: "Amaranto", grams: 55 },
        { name: "Pan integral", grams: 70 },
      ],
    },
  ];
}

describe("applySwap", () => {
  it("cambia el item y voltea la equivalencia (caso feliz)", () => {
    const resultado = applySwap(mealsJsonDeAvena(), equivalencesJsonDeAvena(), {
      slot: "desayuno",
      forName: "Avena",
      toName: "Amaranto",
    });

    const meals = resultado.mealsJson as any[];
    const comida = meals[0];

    // El item pasa a ser la elección, con los gramos EXACTOS de la opción.
    expect(comida.items).toEqual([
      { name: "Amaranto", grams: 55, free: false },
      { name: "Huevo", grams: 100, free: false },
    ]);

    // La equivalencia ahora se busca desde "Amaranto", y "Avena" quedó como
    // la opción para volver, con sus gramos originales.
    expect(comida.equivalences).toEqual([
      {
        forName: "Amaranto",
        options: [
          { name: "Avena", grams: 60 },
          { name: "Pan integral", grams: 70 },
        ],
      },
    ]);

    // La copia aplanada queda coherente con la de la comida.
    const flat = resultado.equivalencesJson as any[];
    expect(flat).toEqual([
      {
        slot: "desayuno",
        forName: "Amaranto",
        options: [
          { name: "Avena", grams: 60 },
          { name: "Pan integral", grams: 70 },
        ],
      },
    ]);

    // El otro item de la comida no se toca.
    expect(comida.items[1]).toEqual({ name: "Huevo", grams: 100, free: false });
  });

  it("ida y vuelta: swap A→B y luego B→A regresa exactamente al original", () => {
    const mealsOriginal = mealsJsonDeAvena();
    const equivalencesOriginal = equivalencesJsonDeAvena();

    const ida = applySwap(mealsOriginal, equivalencesOriginal, {
      slot: "desayuno",
      forName: "Avena",
      toName: "Amaranto",
    });

    const vuelta = applySwap(ida.mealsJson, ida.equivalencesJson, {
      slot: "desayuno",
      forName: "Amaranto",
      toName: "Avena",
    });

    expect(vuelta.mealsJson).toEqual(mealsOriginal);
    expect(vuelta.equivalencesJson).toEqual(equivalencesOriginal);
  });

  it("un vegetal libre intercambiado por otro sigue siendo libre", () => {
    // "Libre" describe al hueco (cantidad sin contar), no al alimento: si la
    // espinaca era libre, el nopal que la sustituye también lo es.
    const meals = [
      {
        slot: "comida",
        label: "Comida",
        timeHint: "2:00 pm",
        items: [{ name: "Espinaca", grams: 100, free: true }],
        equivalences: [
          { forName: "Espinaca", options: [{ name: "Nopal", grams: 100 }] },
        ],
      },
    ];

    const resultado = applySwap(meals, [], {
      slot: "comida",
      forName: "Espinaca",
      toName: "Nopal",
    });

    const comida = (resultado.mealsJson as any[])[0];
    expect(comida.items[0]).toEqual({ name: "Nopal", grams: 100, free: true });
  });

  it("el intercambio conserva el id del alimento en los dos sentidos", () => {
    // Sin el id, la lista de súper —que agrupa por alimento— metía a todos
    // los intercambiados en la misma cubeta y sumaba sus gramos entre sí.
    const meals = [
      {
        slot: "cena",
        label: "Cena",
        timeHint: "20:00",
        items: [{ foodId: "avena", name: "Avena", grams: 60, free: false }],
        equivalences: [
          {
            forName: "Avena",
            options: [{ foodId: "amaranto", name: "Amaranto", grams: 55 }],
          },
        ],
      },
    ];

    const resultado = applySwap(meals, [], {
      slot: "cena",
      forName: "Avena",
      toName: "Amaranto",
    });

    const comida = (resultado.mealsJson as any[])[0];
    expect(comida.items[0]).toEqual({
      foodId: "amaranto",
      name: "Amaranto",
      grams: 55,
      free: false,
    });
    // Y la opción de volver conserva el id del que salió.
    expect(comida.equivalences[0].options[0]).toEqual({
      foodId: "avena",
      name: "Avena",
      grams: 60,
    });
  });

  it("lanza SwapError si el slot no existe", () => {
    expect(() =>
      applySwap(mealsJsonDeAvena(), equivalencesJsonDeAvena(), {
        slot: "cena",
        forName: "Avena",
        toName: "Amaranto",
      }),
    ).toThrow(SwapError);
  });

  it("lanza SwapError si forName no está en la comida", () => {
    expect(() =>
      applySwap(mealsJsonDeAvena(), equivalencesJsonDeAvena(), {
        slot: "desayuno",
        forName: "Camote",
        toName: "Amaranto",
      }),
    ).toThrow(SwapError);
  });

  it("lanza SwapError si toName no es una opción válida para forName", () => {
    expect(() =>
      applySwap(mealsJsonDeAvena(), equivalencesJsonDeAvena(), {
        slot: "desayuno",
        forName: "Avena",
        toName: "Quinoa",
      }),
    ).toThrow(SwapError);
  });

  // Menú 1 de Mau: la comida ya traía 100 g de aguacate y cambiar la crema de
  // cacahuate por su equivalencia metió "aguacate 45 g" en otro renglón.
  describe("si el alimento elegido ya está en la comida, se suma", () => {
    function comidaConAguacate(gramosAguacate: number) {
      return [
        {
          slot: "COMIDA",
          label: "Comida",
          timeHint: "14:00",
          items: [
            { foodId: "atun_agua", name: "Atun en agua drenado", grams: 200, free: false },
            { foodId: "aguacate", name: "Aguacate", grams: gramosAguacate, free: false },
            { foodId: "crema_cacahuate", name: "Crema de cacahuate", grams: 16, free: false },
          ],
          equivalences: [
            {
              forName: "Crema de cacahuate",
              options: [{ foodId: "aguacate", name: "Aguacate", grams: 45 }],
            },
            {
              forName: "Aguacate",
              options: [{ foodId: "almendra", name: "Almendra", grams: 20 }],
            },
          ],
        },
      ];
    }

    it("fusiona en un renglón y suma gramos", () => {
      const r = applySwap(comidaConAguacate(50), [], {
        slot: "COMIDA",
        forName: "Crema de cacahuate",
        toName: "Aguacate",
      });
      const comida = (r.mealsJson as any[])[0];
      const aguacates = comida.items.filter((i: any) => i.name === "Aguacate");
      expect(aguacates).toHaveLength(1);
      expect(aguacates[0].grams).toBe(95);
      expect(comida.items.map((i: any) => i.name)).toEqual(["Atun en agua drenado", "Aguacate"]);
      // La equivalencia del renglón que se fue ya no existe.
      expect(comida.equivalences.map((e: any) => e.forName)).toEqual(["Aguacate"]);
      // Las opciones del aguacate se escalan a los gramos nuevos.
      expect(comida.equivalences[0].options[0].grams).toBe(38);
      expect(r.aviso).toMatch(/se sumó/i);
    });

    it("respeta el tope de la porción y lo dice", () => {
      const r = applySwap(comidaConAguacate(100), [], {
        slot: "COMIDA",
        forName: "Crema de cacahuate",
        toName: "Aguacate",
      });
      const comida = (r.mealsJson as any[])[0];
      const aguacates = comida.items.filter((i: any) => i.name === "Aguacate");
      expect(aguacates).toHaveLength(1);
      // El tope del aguacate en el catálogo son 100 g.
      expect(aguacates[0].grams).toBe(100);
      expect(r.aviso).toMatch(/tope/i);
    });

    it("sin repetido no hay aviso", () => {
      const r = applySwap(mealsJsonDeAvena(), equivalencesJsonDeAvena(), {
        slot: "desayuno",
        forName: "Avena",
        toName: "Amaranto",
      });
      expect(r.aviso).toBeUndefined();
    });
  });
});
