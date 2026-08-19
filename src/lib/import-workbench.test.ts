import { describe, expect, it } from "vitest";
import {
  adaptImportProfile,
  applyImportSelection,
  compareVersions,
  compatibilityModeSelection,
  filePatternForProfile,
  matchImportProfile,
  rowsFromSourceGrid,
  workbookSignature,
} from "./import-workbench";

describe("import workbench", () => {
  it("aplica intervalo e colunas ignoradas sem alterar a origem", () => {
    const rows = [
      { id: 1, nome: "A" },
      { id: 2, nome: "B" },
      { id: 3, nome: "C" },
    ];
    expect(applyImportSelection(rows, { startRow: 2, endRow: 3, ignoredColumns: ["id"] })).toEqual([
      { nome: "B" },
      { nome: "C" },
    ]);
    expect(rows[1]).toEqual({ id: 2, nome: "B" });
  });

  it("reconstrói a tabela escolhendo cabeçalho e região na grade original", () => {
    const grid = {
      startRow: 5,
      startColumn: 2,
      totalRows: 6,
      totalColumns: 5,
      rows: [
        ["Relatório", null, null, null, null],
        ["Data", "Poço", "Torre", "Rodapé", null],
        ["01/08/2026", 1, 2, "ignorar", null],
        ["02/08/2026", 3, 4, "ignorar", null],
        [null, null, null, null, null],
        ["Observação", null, null, null, null],
      ],
      truncatedRows: false,
      truncatedColumns: false,
    };
    expect(
      rowsFromSourceGrid(grid, {
        headerRow: 6,
        startRow: 7,
        endRow: 9,
        startColumn: 2,
        endColumn: 4,
      }),
    ).toEqual([
      { Data: "01/08/2026", Poço: 1, Torre: 2 },
      { Data: "02/08/2026", Poço: 3, Torre: 4 },
    ]);
  });

  it("não aplica seleção fora da parte preservada da grade", () => {
    const grid = {
      startRow: 1,
      startColumn: 1,
      totalRows: 2_000,
      totalColumns: 2,
      rows: [["A", "B"]],
      truncatedRows: true,
      truncatedColumns: false,
    };
    expect(
      rowsFromSourceGrid(grid, {
        headerRow: 1,
        startRow: 2,
        endRow: 2_000,
        startColumn: 1,
        endColumn: 2,
      }),
    ).toEqual([]);
  });

  it("modo de compatibilidade usa a primeira linha com dado como cabeçalho e o resto como dado", () => {
    const grid = {
      startRow: 5,
      startColumn: 2,
      totalRows: 3,
      totalColumns: 3,
      rows: [
        ["Data", "Poço", "Torre"],
        ["01/08/2026", 1, 2],
        ["02/08/2026", 3, 4],
      ],
      truncatedRows: false,
      truncatedColumns: false,
    };
    expect(compatibilityModeSelection(grid)).toEqual({
      startRow: 1,
      endRow: 2,
      ignoredColumns: [],
      source: {
        headerRow: 5,
        startRow: 6,
        endRow: 7,
        startColumn: 2,
        endColumn: 4,
      },
    });
  });

  it("modo de compatibilidade é puramente estrutural: uma linha de título mesclado vira o cabeçalho, sem tentar pular", () => {
    const grid = {
      startRow: 5,
      startColumn: 2,
      totalRows: 4,
      totalColumns: 3,
      rows: [
        ["Relatório mensal", null, null],
        [null, null, null],
        ["Data", "Poço", "Torre"],
        ["01/08/2026", 1, 2],
      ],
      truncatedRows: false,
      truncatedColumns: false,
    };
    expect(compatibilityModeSelection(grid)?.source?.headerRow).toBe(5);
  });

  it("modo de compatibilidade retorna null para grade totalmente vazia", () => {
    const grid = {
      startRow: 1,
      startColumn: 1,
      totalRows: 2,
      totalColumns: 2,
      rows: [
        [null, null],
        [null, null],
      ],
      truncatedRows: false,
      truncatedColumns: false,
    };
    expect(compatibilityModeSelection(grid)).toBeNull();
  });

  it("gera assinatura estável e detecta mudanças de estrutura", () => {
    expect(workbookSignature([{ b: "x", a: 1 }])).toBe(workbookSignature([{ a: 2, b: "y" }]));
    const diff = compareVersions([{ id: 1, valor: 10 }], [{ id: "1", total: 10 }]);
    expect(diff.addedColumns).toEqual(["total"]);
    expect(diff.removedColumns).toEqual(["valor"]);
    expect(diff.typeChanges).toEqual([{ column: "id", before: "number", after: "string" }]);
  });

  it("reaplica perfil após reordenar colunas sem cortar novas linhas", () => {
    const savedRows = [
      { Data: "01/08/2026", Produto: "A", Valor: 10 },
      { Data: "02/08/2026", Produto: "B", Valor: 20 },
    ];
    const profile = adaptImportProfile(
      {
        id: "p1",
        name: "Relatório semanal",
        signature: workbookSignature(savedRows),
        selection: { startRow: 1, endRow: 2, ignoredColumns: ["Produto"] },
        createdAt: 1,
        updatedAt: 1,
      },
      savedRows,
      "relatorio-vendas-2026-08-02.xlsx",
    );
    const nextRows = Array.from({ length: 5 }, (_, index) => ({
      Valor: index * 10,
      Data: `0${index + 1}/08/2026`,
      Produto: `P${index}`,
    }));

    const match = matchImportProfile([profile], nextRows, "relatorio-vendas-2026-08-09.xlsx");

    expect(match?.exact).toBe(true);
    expect(match?.selection.endRow).toBe(5);
    expect(match?.selection.ignoredColumns).toEqual(["Produto"]);
  });

  it("reconhece coluna renomeada e adapta a regra que a ignorava", () => {
    const savedRows = [
      { Data: "01/08/2026", Produto: "A", Valor: 10, Unidade: "kg" },
      { Data: "02/08/2026", Produto: "B", Valor: 20, Unidade: "kg" },
    ];
    const profile = adaptImportProfile(
      {
        id: "p2",
        name: "Recebimento",
        signature: workbookSignature(savedRows),
        selection: { startRow: 1, endRow: 2, ignoredColumns: ["Valor"] },
        createdAt: 1,
        updatedAt: 1,
      },
      savedRows,
      "recebimento-2026-08-02.xlsx",
    );
    const nextRows = [
      { Produto: "A", Data: "08/08/2026", "Valor total": 12, Unidade: "kg" },
      { Produto: "B", Data: "09/08/2026", "Valor total": 25, Unidade: "kg" },
    ];

    const match = matchImportProfile([profile], nextRows, "recebimento-2026-08-09.xlsx");

    expect(match?.exact).toBe(false);
    expect(match?.selection.ignoredColumns).toEqual(["Valor total"]);
    expect(match?.changes.renamedColumns).toEqual([{ before: "Valor", after: "Valor total" }]);
  });

  it("não reaplica perfil em arquivo sem sobreposição estrutural suficiente", () => {
    const savedRows = [{ Data: "01/08/2026", Produto: "A", Valor: 10 }];
    const profile = adaptImportProfile(
      {
        id: "p3",
        name: "Vendas",
        signature: workbookSignature(savedRows),
        selection: { startRow: 1, endRow: 1, ignoredColumns: [] },
        createdAt: 1,
        updatedAt: 1,
      },
      savedRows,
      "vendas-01.xlsx",
    );

    expect(
      matchImportProfile(
        [profile],
        [{ Funcionário: "Ana", Departamento: "Qualidade", Turno: "A" }],
        "vendas-02.xlsx",
      ),
    ).toBeUndefined();
  });

  it("normaliza versões e datas no padrão do nome do arquivo", () => {
    expect(filePatternForProfile("Relatório Vendas 2026-08-12 v3.xlsx")).toBe("relatorio vendas v");
  });

  it("não transforma uma troca de cabeçalho em todas as linhas adicionadas e removidas", () => {
    const previous = Array.from({ length: 794 }, (_, index) => ({
      Data: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      Ponto: `P${index}`,
      "Torre de Processo": index,
      Resultado: index * 2,
    }));
    const next = previous.map(({ "Torre de Processo": value, ...row }) => ({
      ...row,
      "NaN/NaN/NaN": value,
    }));
    const diff = compareVersions(previous, next);
    expect(diff.status).toBe("warning");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.changed).toBe(0);
    expect(diff.invalidColumns).toEqual(["NaN/NaN/NaN"]);
    expect(diff.removedColumns).toEqual(["Torre de Processo"]);
  });

  it("detecta alteração real usando uma chave estável", () => {
    const diff = compareVersions(
      [
        { id: "A", valor: 10 },
        { id: "B", valor: 20 },
      ],
      [
        { id: "A", valor: 15 },
        { id: "C", valor: 30 },
      ],
    );
    expect(diff.comparisonMethod).toBe("key");
    expect(diff).toMatchObject({ added: 1, removed: 1, changed: 1 });
    expect(diff.cellChanges).toEqual([
      expect.objectContaining({ identity: "a", column: "valor", before: 10, after: 15 }),
    ]);
  });

  it("recusa comparação quando a estrutura não tem sobreposição suficiente", () => {
    const diff = compareVersions([{ a: 1, b: 2 }], [{ x: 1, y: 2 }]);
    expect(diff.status).toBe("incompatible");
    expect(diff).toMatchObject({ added: 0, removed: 0, changed: 0 });
  });
});
