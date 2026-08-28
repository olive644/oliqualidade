import { describe, expect, it } from "vitest";
import { describeImportProgress, IMPORT_STAGE_LABELS } from "@/lib/import-progress";

describe("progresso da leitura na tela", () => {
  it("não desenha barra na etapa que não sabe medir", () => {
    const view = describeImportProgress({ stage: "parsing" }, 0);

    expect(view.ratio).toBeNull();
    expect(view.detail).toBeNull();
    expect(view.label).toBe(IMPORT_STAGE_LABELS.parsing);
  });

  it("converte a fração em percentual, sem citar abas onde o denominador é dobrado", () => {
    // A verificação percorre cada aba duas vezes, então o total vem dobrado.
    // Um texto em abas mentiria aqui; o percentual continua verdadeiro.
    const view = describeImportProgress({ stage: "verifying", completed: 6, total: 24 }, 0);

    expect(view.ratio).toBeCloseTo(0.25);
    expect(view.detail).toBe("25%");
    expect(view.detail).not.toContain("aba");
  });

  it("mostra as abas encontradas enquanto elas chegam, só durante a análise", () => {
    const analisando = describeImportProgress({ stage: "analyzing", completed: 3, total: 4 }, 3);
    expect(analisando.detail).toBe("75% · 3 abas encontradas");

    const uma = describeImportProgress({ stage: "analyzing", completed: 1, total: 4 }, 1);
    expect(uma.detail).toBe("25% · 1 aba encontrada");

    // Antes da análise o número seria sempre zero, e "0 abas" durante metade da
    // espera soa a erro em vez de a trabalho em andamento.
    const verificando = describeImportProgress({ stage: "verifying", completed: 1, total: 4 }, 0);
    expect(verificando.detail).toBe("25%");
  });

  it("nunca passa de cem por cento nem fica negativo", () => {
    expect(describeImportProgress({ stage: "analyzing", completed: 9, total: 4 }, 0).ratio).toBe(1);
    expect(describeImportProgress({ stage: "analyzing", completed: -2, total: 4 }, 0).ratio).toBe(
      0,
    );
  });

  it("ignora total ausente ou zerado em vez de dividir por zero", () => {
    expect(
      describeImportProgress({ stage: "analyzing", completed: 2, total: 0 }, 0).ratio,
    ).toBeNull();
    expect(describeImportProgress({ stage: "analyzing", completed: 2 }, 0).ratio).toBeNull();
  });

  it("tem rótulo em português para todas as etapas, sem termo técnico", () => {
    for (const [stage, label] of Object.entries(IMPORT_STAGE_LABELS)) {
      expect(label.length, stage).toBeGreaterThan(10);
      expect(label).not.toMatch(/parsing|decoding|error|XLSX\.read/i);
    }
  });
});
