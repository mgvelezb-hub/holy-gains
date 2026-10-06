import { describe, expect, it } from "vitest";

import { diasRecientes, etiquetaDeDia } from "@/lib/ciclo";

describe("fechas de la pantalla del ciclo", () => {
  it("los últimos días, del más reciente al más viejo, cruzando de mes", () => {
    expect(diasRecientes("2026-10-02", 4)).toEqual(["2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29"]);
  });

  it("el día se dice como se recuerda", () => {
    expect(etiquetaDeDia("2026-10-05", "2026-10-05")).toBe("Hoy");
    expect(etiquetaDeDia("2026-10-04", "2026-10-05")).toBe("Ayer");
    expect(etiquetaDeDia("2026-10-03", "2026-10-05")).toBe("sáb 3 oct");
  });
});
