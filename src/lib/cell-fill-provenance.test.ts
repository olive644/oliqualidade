import { describe, expect, it } from "vitest";
import {
  resolveColorGroupLabels,
  resolveScheduleFillStates,
  resolveSourceCellFills,
} from "@/lib/cell-fill-provenance";
import type { SourceCellFill } from "@/lib/cell-fill-provenance";
import type { ImportAudit, SourceGrid } from "@/lib/import";
import type { ImportDiagnostics } from "@/lib/import-intelligence";
import type { Column, Row } from "@/lib/types";

const columns: Column[] = [
  { key: "nivel", label: "Nível", kind: "text", visible: true, description: "" },
  { key: "baixa", label: "Baixa (1)", kind: "number", visible: true, description: "" },
];

const rows: Row[] = [
  { nivel: "Alto (3)", baixa: 3 },
  { nivel: "Médio (2)", baixa: 2 },
];

const cleanAudit: ImportAudit = {
  sourceNonEmptyCells: 4,
  outputNonEmptyCells: 4,
  formulaCellsRecovered: 0,
  mergedCellsExpanded: 0,
  numericCellsConverted: 0,
  rowsAboveHeaderIgnored: 0,
  hiddenRowsIgnored: 0,
  blankRowsIgnored: 0,
  trailingRowsIgnored: 0,
  columnsIgnored: 0,
};

// Cabeçalho na linha 1 (índice 0), dados nas linhas 2-3 (índices 1-2), sem
// nenhuma lacuna — mesma forma da matriz de critério real (seção 79).
const sourceGrid: SourceGrid = {
  startRow: 1,
  startColumn: 1,
  totalRows: 3,
  totalColumns: 2,
  rows: [
    ["Nível", "Baixa (1)"],
    ["Alto (3)", 3],
    ["Médio (2)", 2],
  ],
  truncatedRows: false,
  truncatedColumns: false,
};

const diagnostics = (cellFills: ImportDiagnostics["cellFills"]) =>
  ({
    header: { row: 1, confidence: 1 },
    cellFills,
  }) as ImportDiagnostics;

describe("resolveSourceCellFills", () => {
  it("resolve cor por linha+coluna quando a aba é simples e sem lacuna", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([
        { address: "B2", color: "#FFFF00" },
        { address: "B3", color: "#00B050" },
      ]),
      cleanAudit,
      sourceGrid,
    );
    expect(resolved).toEqual([
      { rowIndex: 0, columnKey: "baixa", color: "#FFFF00" },
      { rowIndex: 1, columnKey: "baixa", color: "#00B050" },
    ]);
  });

  it("não resolve nada quando alguma linha foi pulada entre o cabeçalho e os dados", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      { ...cleanAudit, hiddenRowsIgnored: 3 },
      sourceGrid,
    );
    expect(resolved).toEqual([]);
  });

  it("não resolve nada quando a grade de origem foi truncada", () => {
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      cleanAudit,
      { ...sourceGrid, truncatedRows: true },
    );
    expect(resolved).toEqual([]);
  });

  it("não mapeia uma coluna cujo rótulo bate com mais de uma célula do cabeçalho", () => {
    const ambiguousGrid: SourceGrid = {
      ...sourceGrid,
      rows: [
        ["Baixa (1)", "Baixa (1)"],
        ["Alto (3)", 3],
        ["Médio (2)", 2],
      ],
    };
    const resolved = resolveSourceCellFills(
      rows,
      columns,
      diagnostics([{ address: "B2", color: "#FFFF00" }]),
      cleanAudit,
      ambiguousGrid,
    );
    expect(resolved).toEqual([]);
  });

  it("não resolve nada sem cellFills, audit ou sourceGrid", () => {
    expect(resolveSourceCellFills(rows, columns, diagnostics([]), cleanAudit, sourceGrid)).toEqual(
      [],
    );
    expect(
      resolveSourceCellFills(
        rows,
        columns,
        diagnostics([{ address: "B2", color: "#FFFF00" }]),
        undefined,
        sourceGrid,
      ),
    ).toEqual([]);
  });
});

describe("resolveColorGroupLabels", () => {
  // Caso real: "Anexo III" - "Bebidas lácteas/Iogurtes" cobre 3 linhas por
  // cor de preenchimento, sem nenhuma mesclagem de célula na coluna A.
  const groupColumns: Column[] = [
    { key: "categoria", label: "Categoria", kind: "text", visible: true, description: "" },
    { key: "item", label: "Item", kind: "text", visible: true, description: "" },
  ];
  const groupRows: Row[] = [
    { categoria: "Bebidas lácteas/Iogurtes", item: "Leite" },
    { categoria: null, item: "Iogurte natural" },
    { categoria: null, item: "Iogurte grego" },
    { categoria: "Água mineral", item: "Sem gás" },
  ];

  it("propaga o rótulo pra linhas vazias na mesma banda de cor", () => {
    const fills: SourceCellFill[] = [
      { rowIndex: 0, columnKey: "categoria", color: "#FCE4D6" },
      { rowIndex: 1, columnKey: "categoria", color: "#FCE4D6" },
      { rowIndex: 2, columnKey: "categoria", color: "#FCE4D6" },
    ];
    expect(resolveColorGroupLabels(groupRows, groupColumns, fills)).toEqual([
      { rowIndex: 1, columnKey: "categoria", label: "Bebidas lácteas/Iogurtes" },
      { rowIndex: 2, columnKey: "categoria", label: "Bebidas lácteas/Iogurtes" },
    ]);
  });

  it("não propaga quando a cor muda entre as linhas vazias", () => {
    const fills: SourceCellFill[] = [
      { rowIndex: 0, columnKey: "categoria", color: "#FCE4D6" },
      { rowIndex: 1, columnKey: "categoria", color: "#DDEBF7" },
      { rowIndex: 2, columnKey: "categoria", color: "#FCE4D6" },
    ];
    expect(resolveColorGroupLabels(groupRows, groupColumns, fills)).toEqual([]);
  });

  it("não propaga quando a linha vazia não tem nenhuma cor de preenchimento", () => {
    const fills: SourceCellFill[] = [{ rowIndex: 0, columnKey: "categoria", color: "#FCE4D6" }];
    expect(resolveColorGroupLabels(groupRows, groupColumns, fills)).toEqual([]);
  });

  it("nunca gera rótulo pra uma linha que já tem valor próprio", () => {
    const fills: SourceCellFill[] = [
      { rowIndex: 0, columnKey: "categoria", color: "#FCE4D6" },
      { rowIndex: 3, columnKey: "categoria", color: "#FCE4D6" },
    ];
    const resolved = resolveColorGroupLabels(groupRows, groupColumns, fills);
    expect(resolved.some((r) => r.rowIndex === 3)).toBe(false);
  });

  it("retorna vazio sem nenhum sourceCellFills", () => {
    expect(resolveColorGroupLabels(groupRows, groupColumns, [])).toEqual([]);
  });
});

// Estrutura do FRS-QA-BR-413 (cronograma de calibração real): cabeçalho
// hierárquico de duas linhas, cada mês cobrindo DUAS colunas mescladas
// (previsto | ocorrido), meses sem texto nenhum — o andamento existe só como
// cor de célula — e linhas ocultas/em branco descartadas no meio dos dados.
const scheduleColumns: Column[] = [
  { key: "equipamento", label: "EQUIPAMENTO", kind: "text", visible: true, description: "" },
  {
    key: "jan",
    label: "CALIBRAÇÃO 2023 — JAN",
    kind: "text",
    visible: true,
    description: "",
  },
  {
    key: "fev",
    label: "CALIBRAÇÃO 2023 — FEV",
    kind: "text",
    visible: true,
    description: "",
  },
];

const scheduleRows: Row[] = [{ equipamento: "Altímetro", jan: null, fev: null }];

const scheduleGrid: SourceGrid = {
  startRow: 1,
  startColumn: 1,
  totalRows: 4,
  totalColumns: 5,
  rows: [
    ["EQUIPAMENTO", "CALIBRAÇÃO 2023", null, null, null],
    [null, "JAN", null, "FEV", null],
    ["Linha oculta", null, null, null, null],
    ["Altímetro", null, null, null, null],
  ],
  truncatedRows: false,
  truncatedColumns: false,
};

const scheduleAudit: ImportAudit = { ...cleanAudit, hiddenRowsIgnored: 1 };

const scheduleDiagnostics = (cellFills: ImportDiagnostics["cellFills"]) =>
  ({ header: { row: 1, confidence: 1 }, cellFills }) as ImportDiagnostics;

describe("resolveScheduleFillStates", () => {
  it("lê o andamento que a planilha registra só como cor da célula", () => {
    // B4/C4 = JAN (azul + verde), D4/E4 = FEV (azul + amarelo).
    const resolved = resolveScheduleFillStates(
      scheduleRows,
      scheduleColumns,
      scheduleDiagnostics([
        { address: "B4", color: "#0000FF" },
        { address: "C4", color: "#00B050" },
        { address: "D4", color: "#0000FF" },
        { address: "E4", color: "#FFFF00" },
      ]),
      scheduleAudit,
      scheduleGrid,
      [3],
    );
    expect(resolved).toEqual([
      { rowIndex: 0, columnKey: "jan", state: "done" },
      { rowIndex: 0, columnKey: "fev", state: "warning" },
    ]);
  });

  it("ignora o zebrado cinza da tabela, que não é marcação de andamento", () => {
    const resolved = resolveScheduleFillStates(
      scheduleRows,
      scheduleColumns,
      scheduleDiagnostics([
        { address: "B4", color: "#D9D9D9" },
        { address: "C4", color: "#FFFFFF" },
      ]),
      scheduleAudit,
      scheduleGrid,
      [3],
    );
    expect(resolved).toEqual([]);
  });

  it("sem rowOrigins, não arrisca associar cor à linha errada quando houve descarte", () => {
    const resolved = resolveScheduleFillStates(
      scheduleRows,
      scheduleColumns,
      scheduleDiagnostics([{ address: "B4", color: "#00B050" }]),
      scheduleAudit,
      scheduleGrid,
    );
    expect(resolved).toEqual([]);
  });
});
