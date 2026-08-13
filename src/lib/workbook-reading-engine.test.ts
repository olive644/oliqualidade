import { describe, expect, it } from "vitest";

import {
  registeredWasmWorkbookReader,
  shouldTryWasm,
  workbookFormat,
} from "@/lib/workbook-reading-engine";

describe("contrato do Reading Engine v2", () => {
  it("reconhece o formato sem depender do nome completo", () => {
    expect(workbookFormat("Plano de Produção.XLSX")).toBe("xlsx");
    expect(workbookFormat("sem-extensao")).toBe("sem-extensao");
  });

  it("não tenta o adaptador WASM quando ele não foi registrado", () => {
    expect(registeredWasmWorkbookReader()).toBeUndefined();
    expect(shouldTryWasm("relatorio.xlsx")).toBe(false);
  });
});
