import { describe, expect, it } from "vitest";

import {
  parseSmartImportAnalysis,
  smartImportFingerprint,
  validateSmartImportInput,
  type SmartImportInput,
} from "@/lib/smart-import";

const input: SmartImportInput = {
  fileName: "cronograma.xlsx",
  sheetName: "Plano anual",
  rowCount: 10,
  columnCount: 3,
  confidence: 72,
  interpretationScore: 100,
  consistencyScore: 100,
  header: { row: 4, confidence: 0.8 },
  columns: [
    {
      key: "Dados",
      label: "Dados",
      kind: "category",
      filled: 10,
      missing: 0,
      unique: 4,
      examples: ["Água", "Ar"],
      sensitive: false,
    },
    {
      key: "jan",
      label: "jan",
      kind: "category",
      filled: 2,
      missing: 8,
      unique: 1,
      examples: ["M"],
      sensitive: false,
    },
    {
      key: "Contato",
      label: "Contato",
      kind: "text",
      filled: 2,
      missing: 8,
      unique: 2,
      examples: ["pessoa@empresa.com"],
      sensitive: false,
    },
  ],
  regions: [],
  warnings: [],
  transformations: [],
};

describe("análise inteligente de importação", () => {
  it("remove exemplos sensíveis mesmo quando o cliente não os marcou", () => {
    const safe = validateSmartImportInput(input);
    expect(safe.columns.find((column) => column.key === "Contato")?.examples).toEqual([]);
  });

  it("aceita somente sugestões referentes a colunas reais", () => {
    const analysis = parseSmartImportAnalysis(
      JSON.stringify({
        purpose: "Cronograma anual",
        summary: "Estrutura reconhecida.",
        confidence: 94,
        suggestions: [
          {
            type: "rename-column",
            columnKey: "Dados",
            proposedLabel: "Categoria",
            confidence: 95,
            reason: "Valores categóricos recorrentes.",
          },
          {
            type: "ignore-column",
            columnKey: "coluna-inexistente",
            confidence: 99,
            reason: "Não existe.",
          },
        ],
        warnings: [],
      }),
      input,
    );
    expect(analysis.suggestions).toHaveLength(1);
    expect(analysis.suggestions[0]).toMatchObject({
      type: "rename-column",
      columnKey: "Dados",
      proposedLabel: "Categoria",
    });
  });

  it("produz a mesma impressão digital sem depender dos exemplos", () => {
    expect(
      smartImportFingerprint({
        ...input,
        columns: input.columns.map((column) => ({ ...column, examples: ["outro exemplo"] })),
      }),
    ).toBe(smartImportFingerprint(input));
  });
});
