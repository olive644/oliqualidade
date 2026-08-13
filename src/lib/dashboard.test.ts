import { describe, expect, it } from "vitest";
import {
  mergeReimportedColumns,
  migrateDashboard,
  migrateDashboards,
  mergeReimportedSheets,
} from "@/lib/dashboard";
import type { Bookmark, ChartConfig, Column, Row, SheetData, Widget } from "@/lib/types";

const columns: Column[] = [
  { key: "nome", label: "Nome", kind: "text", visible: true, description: "" },
];
const rows: Row[] = [{ nome: "Bolo" }];

describe("migrateDashboard", () => {
  it("envolve um painel do formato antigo (rows/columns direto) numa aba única chamada 'Dados'", () => {
    const legacy = {
      id: "1",
      name: "Vendas",
      rows,
      columns,
      filters: [{ key: "nome", value: "Bolo" }],
      createdAt: 100,
      updatedAt: 200,
      pinned: true,
      widgets: [],
      bookmarks: [],
    };
    const migrated = migrateDashboard(legacy);
    expect(migrated.id).toBe("1");
    expect(migrated.name).toBe("Vendas");
    expect(migrated.activeSheetIndex).toBe(0);
    expect(migrated.sheets).toHaveLength(1);
    expect(migrated.sheets[0]).toMatchObject({
      name: "Dados",
      rows,
      columns,
      filters: [{ key: "nome", value: "Bolo" }],
      widgets: [],
      bookmarks: [],
    });
    expect(migrated.pinned).toBe(true);
  });

  it("preenche rows/columns/filters ausentes com valores vazios em painéis antigos incompletos", () => {
    const legacy = { id: "2", name: "Vazio", createdAt: 0, updatedAt: 0, pinned: false };
    const migrated = migrateDashboard(legacy);
    expect(migrated.sheets[0]).toMatchObject({ rows: [], columns: [], filters: [] });
  });

  it("mantém um painel já no formato novo (sheets) praticamente inalterado", () => {
    const modern = {
      id: "3",
      name: "Multi-aba",
      sheets: [
        { name: "Vendas", rows, columns, filters: [] },
        { name: "Resumo", rows: [], columns: [], filters: [] },
      ],
      activeSheetIndex: 1,
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    };
    const migrated = migrateDashboard(modern);
    expect(migrated.sheets).toHaveLength(2);
    expect(migrated.activeSheetIndex).toBe(1);
    expect(migrated.sheets[0]!.name).toBe("Vendas");
  });

  it("preserva a última contagem da pasta monitorada", () => {
    const folderMonitor = {
      folderName: "Relatórios",
      fileName: "principal.xlsx",
      fileCount: 2,
      fileNames: ["principal.xlsx", "apoio.xlsx"],
      status: "watching" as const,
      lastSyncedAt: 10,
    };
    const migrated = migrateDashboard({
      id: "monitor",
      name: "Monitor",
      sheets: [{ name: "Dados", rows, columns, filters: [] }],
      activeSheetIndex: 0,
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
      folderMonitor,
    });
    expect(migrated.folderMonitor).toEqual(folderMonitor);
  });

  it("corrige um activeSheetIndex inválido (fora dos limites) para 0, em vez de quebrar", () => {
    const modern = {
      id: "4",
      name: "Índice inválido",
      sheets: [{ name: "Única", rows: [], columns: [], filters: [] }],
      activeSheetIndex: 5,
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    };
    const migrated = migrateDashboard(modern);
    expect(migrated.activeSheetIndex).toBe(0);
  });

  it("migra uma lista inteira preservando a ordem", () => {
    const list = [
      { id: "a", name: "A", rows: [], columns: [], createdAt: 0, updatedAt: 0, pinned: false },
      { id: "b", name: "B", rows: [], columns: [], createdAt: 0, updatedAt: 0, pinned: false },
    ];
    const migrated = migrateDashboards(list);
    expect(migrated.map((d) => d.id)).toEqual(["a", "b"]);
    expect(migrated.every((d) => d.sheets.length === 1)).toBe(true);
  });
});

describe("mergeReimportedSheets", () => {
  const widget = [{ id: "w1" }] as unknown as Widget[];
  const bookmark = [{ id: "b1" }] as unknown as Bookmark[];
  const chartConfig = { x: "nome" } as unknown as ChartConfig;

  it("casa uma aba nova com a antiga de mesmo nome e preserva widgets/marcadores/chartConfig", () => {
    const oldSheets: SheetData[] = [
      {
        name: "Vendas",
        rows: [{ nome: "Bolo" }],
        columns,
        filters: [{ key: "nome", value: "Bolo" }],
        widgets: widget,
        bookmarks: bookmark,
        chartConfig,
      },
    ];
    const merged = mergeReimportedSheets(oldSheets, [
      { name: "Vendas", rows: [{ nome: "Torta" }], columns },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Vendas",
      rows: [{ nome: "Torta" }],
      filters: [], // filtros sempre reiniciam numa reimportação
      widgets: [expect.objectContaining({ type: "version-compare" }), ...widget],
      bookmarks: bookmark,
      chartConfig,
    });
    expect(merged[0]!.previousSnapshot?.rows).toEqual([{ nome: "Bolo" }]);
  });

  it("uma aba nova sem correspondente antiga nasce do zero, sem widgets/marcadores/snapshot", () => {
    const oldSheets: SheetData[] = [
      { name: "Vendas", rows, columns, filters: [], widgets: widget, bookmarks: bookmark },
    ];
    const merged = mergeReimportedSheets(oldSheets, [{ name: "Estoque", rows, columns }]);
    expect(merged[0]!.name).toBe("Estoque");
    expect(merged[0]!.widgets).toBeUndefined();
    expect(merged[0]!.bookmarks).toBeUndefined();
    expect(merged[0]!.previousSnapshot).toBeUndefined();
  });

  it("preserva confirmações semânticas e decisões de exceção na reimportação", () => {
    const oldSheets: SheetData[] = [
      {
        name: "Vendas",
        rows: [{ nome: "Bolo" }, { nome: "Bolo" }],
        columns,
        filters: [],
        semanticOverrides: { nome: { role: "identifier" } },
        exceptionDecisions: {
          "duplicate-1": { status: "resolved", updatedAt: 123 },
        },
      },
    ];
    const [merged] = mergeReimportedSheets(oldSheets, [
      { name: "Vendas", rows: [{ nome: "Torta" }, { nome: "Torta" }], columns },
    ]);
    expect(merged?.semanticOverrides).toEqual({ nome: { role: "identifier" } });
    expect(merged?.exceptionDecisions?.["duplicate-1"]).toEqual({
      status: "resolved",
      updatedAt: 123,
    });
    expect(merged?.intelligence?.columns[0]).toMatchObject({
      key: "nome",
      role: "identifier",
      confidence: 100,
    });
  });

  it("mantém widgets automáticos em uma aba realmente nova", () => {
    const autoWidgets = [{ id: "auto-1" }] as unknown as Widget[];
    const merged = mergeReimportedSheets(
      [],
      [{ name: "Nova", rows, columns, widgets: autoWidgets }],
    );
    expect(merged[0]?.widgets).toBe(autoWidgets);
  });

  it("uma aba antiga sem correspondente na nova importação é descartada", () => {
    const oldSheets: SheetData[] = [
      { name: "Vendas", rows, columns, filters: [] },
      { name: "Resumo antigo", rows, columns, filters: [] },
    ];
    const merged = mergeReimportedSheets(oldSheets, [{ name: "Vendas", rows, columns }]);
    expect(merged.map((s) => s.name)).toEqual(["Vendas"]);
  });

  it("preserva formatação, visibilidade, tipo e colunas calculadas ao atualizar a fonte", () => {
    const oldColumns: Column[] = [
      {
        key: "receita",
        label: "Receita líquida",
        kind: "currency",
        visible: false,
        description: "Após descontos",
        missingRule: "zero",
        conditionalFormat: [
          { id: "meta", type: "threshold", operator: "gte", value: 100, color: "#16a34a" },
        ],
      },
      {
        key: "margem_calc",
        label: "Margem calculada",
        kind: "percentage",
        visible: true,
        description: "",
        formula: "receita / custo",
      },
    ];
    const freshColumns: Column[] = [
      {
        key: "receita",
        label: "receita",
        kind: "number",
        visible: true,
        description: "",
      },
      { key: "custo", label: "Custo", kind: "currency", visible: true, description: "" },
    ];

    const merged = mergeReimportedColumns(oldColumns, freshColumns);

    expect(merged.find((column) => column.key === "receita")).toMatchObject(oldColumns[0]!);
    expect(merged.find((column) => column.key === "custo")).toMatchObject(freshColumns[1]!);
    expect(merged.find((column) => column.key === "margem_calc")?.formula).toBe("receita / custo");
  });
});

describe("migração de widgets incompatíveis", () => {
  it("remove métricas antigas baseadas em códigos e mantém a tabela", () => {
    const migrated = migrateDashboard({
      id: "controle",
      name: "Controle",
      sheets: [
        {
          name: "Dados",
          rows: [{ "Nº 1": "39960", "Data G": "20/05/2026" }],
          columns: [
            { key: "Nº 1", label: "Nº 1", kind: "text", visible: true, description: "" },
            { key: "Data G", label: "Data G", kind: "date", visible: true, description: "" },
          ],
          filters: [],
          widgets: [
            { id: "bad", type: "metric-trend", metricKey: "Nº 1", span: 1, size: "sm" },
            { id: "table", type: "table", span: 3, size: "md" },
          ],
        },
      ],
      activeSheetIndex: 0,
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    });
    expect(migrated.sheets[0]?.widgets?.some((widget) => widget.id === "bad")).toBe(false);
    expect(migrated.sheets[0]?.widgets?.some((widget) => widget.type === "table")).toBe(true);
    expect(migrated.sheets[0]?.autoDashboard?.warnings.join(" ")).toContain(
      "Nenhuma métrica numérica segura",
    );
  });

  it("divide um cronograma automático antigo em widgets por bloco ao reabrir o painel", () => {
    const scheduleColumns: Column[] = [
      { key: "Bloco", label: "Bloco", kind: "category", visible: true, description: "" },
      {
        key: "Ponto / Item",
        label: "Ponto / Item",
        kind: "category",
        visible: true,
        description: "",
      },
      { key: "jun/2025", label: "jun/2025", kind: "number", visible: true, description: "" },
      { key: "set/2025", label: "set/2025", kind: "number", visible: true, description: "" },
      { key: "dez/2025", label: "dez/2025", kind: "number", visible: true, description: "" },
    ];
    const scheduleRows: Row[] = [
      { Bloco: "Bolores", "Ponto / Item": "IN01", "jun/2025": 4 },
      { Bloco: "Mesófilos", "Ponto / Item": "IN01", "jun/2025": 2 },
    ];
    const migrated = migrateDashboard({
      id: "schedule",
      name: "Cronograma",
      sheets: [
        {
          name: "Monitoramento",
          rows: scheduleRows,
          columns: scheduleColumns,
          filters: [],
          widgets: [
            {
              id: "old-schedule",
              type: "schedule-heatmap",
              groupKey: "Ponto / Item",
              sectionKey: "Bloco",
              periodKeys: ["jun/2025", "set/2025", "dez/2025"],
              span: 3,
              size: "md",
            },
            { id: "table", type: "table", span: 3, size: "md" },
          ],
        },
      ],
      activeSheetIndex: 0,
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    });
    const widgets = migrated.sheets[0]?.widgets ?? [];
    expect(widgets.filter((widget) => widget.type === "schedule-heatmap")).toHaveLength(2);
    expect(
      widgets
        .filter((widget) => widget.type === "schedule-heatmap")
        .map((widget) => widget.blockValue),
    ).toEqual(["Bolores", "Mesófilos"]);
    expect(widgets.some((widget) => widget.id === "old-schedule")).toBe(false);
    expect(widgets.some((widget) => widget.id === "table")).toBe(true);
  });
});
