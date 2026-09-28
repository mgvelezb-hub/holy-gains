import { describe, expect, it } from "vitest";

import { Parrafo } from "@/components/Parrafo";
import { parrafo } from "@/lib/theme";

/**
 * El párrafo justificado. No se monta RN: `Parrafo` es una función que
 * devuelve un elemento `Text`, y basta con leer sus props.
 */
describe("Parrafo", () => {
  it("el estilo base solo justifica: no toca tamaño ni color", () => {
    expect(parrafo).toEqual({ textAlign: "justify" });
  });

  it("justifica encima del estilo que traiga y guiona en Android", () => {
    const elemento = Parrafo({ style: { fontSize: 17, color: "#fff", textAlign: "center" }, children: "Texto" });
    expect(elemento.props.style).toEqual([{ fontSize: 17, color: "#fff", textAlign: "center" }, parrafo]);
    expect(elemento.props.android_hyphenationFrequency).toBe("full");
    expect(elemento.props.children).toBe("Texto");
  });
});
