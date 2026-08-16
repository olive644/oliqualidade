import { describe, expect, it } from "vitest";

import {
  buildDefaultWidgets,
  columnDragType,
  columnDropAccepted,
  createWidget,
  duplicateWidget,
  draggedColumnKind,
  groupableKinds,
  newWidgetId,
  pickBestGroupColumn,
  schedulePeriodColumns,
  scheduleDetailColumns,
  scheduleSectionColumn,
  scheduleStatusColumn,
} from "@/lib/widgets";
import { numericKinds } from "@/lib/types";
import type { Column, Row } from "@/lib/types";

const col = (key: string, kind: Column["kind"]): Column => ({
  key,
  label: key,
  kind,
  visible: true,
  description: "",
});

describe("newWidgetId", () => {
  it("gera ids únicos", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newWidgetId()));
    expect(ids.size).toBe(20);
  });
});

describe("duplicateWidget", () => {
  it("preserva a configuração e gera um identificador novo", () => {
    const original = {
      id: "widget_original",
      type: "bar" as const,
      title: "Receita por região",
      groupKey: "regiao",
      valueKey: "receita",
      op: "avg" as const,
      span: 2 as const,
      size: "lg" as const,
    };

    const copy = duplicateWidget(original);

    expect(copy).toEqual({ ...original, id: expect.any(String) });
    expect(copy.id).not.toBe(original.id);
    expect(copy).not.toBe(original);
  });
});

describe("buildDefaultWidgets", () => {
  const columns: Column[] = [
    col("receita", "currency"),
    col("custo", "currency"),
    col("margem", "percentage"),
    col("categoria", "category"),
    col("data_venda", "date"),
  ];

  it("reproduz o layout antigo: até 3 métricas, barra, pizza, linha e tabela", () => {
    const widgets = buildDefaultWidgets(columns);
    const types = widgets.map((w) => w.type);
    expect(types.filter((t) => t === "metric")).toHaveLength(3);
    expect(types).toContain("bar");
    expect(types).toContain("pie");
    expect(types).toContain("line");
    expect(types[types.length - 1]).toBe("table");
  });

  it("usa as 3 primeiras colunas numéricas como métricas", () => {
    const widgets = buildDefaultWidgets(columns);
    const metricKeys = widgets.filter((w) => w.type === "metric").map((w) => w.metricKey);
    expect(metricKeys).toEqual(["receita", "custo", "margem"]);
  });

  it("usa o chartConfig legado para definir agrupamento/valor/operação da barra quando fornecido", () => {
    const widgets = buildDefaultWidgets(columns, {
      groupKey: "data_venda",
      valueKey: "custo",
      op: "avg",
    });
    const bar = widgets.find((w) => w.type === "bar");
    expect(bar?.groupKey).toBe("data_venda");
    expect(bar?.valueKey).toBe("custo");
    expect(bar?.op).toBe("avg");
  });

  it("não adiciona pizza sem coluna de categoria/texto, nem linha sem coluna de data", () => {
    const numericOnly: Column[] = [col("receita", "currency"), col("custo", "currency")];
    const widgets = buildDefaultWidgets(numericOnly);
    const types = widgets.map((w) => w.type);
    expect(types).not.toContain("pie");
    expect(types).not.toContain("line");
    expect(types).not.toContain("bar");
    expect(types).toContain("table");
  });
});

describe("pickBestGroupColumn", () => {
  it("evita coluna quase vazia quando há alternativa melhor preenchida", () => {
    const colunaVazia = col("coluna_6", "category");
    const colunaBoa = col("status_parcela", "category");
    const rows: Row[] = [
      { coluna_6: null, status_parcela: "Em dia" },
      { coluna_6: null, status_parcela: "Atrasada" },
      { coluna_6: null, status_parcela: "Em dia" },
      { coluna_6: "único valor perdido", status_parcela: "Quitada" },
    ];
    const best = pickBestGroupColumn([colunaVazia, colunaBoa], rows);
    expect(best?.key).toBe("status_parcela");
  });

  it("cai de volta na primeira candidata se todas forem quase vazias", () => {
    const a = col("a", "category");
    const b = col("b", "category");
    const rows: Row[] = [
      { a: null, b: null },
      { a: null, b: null },
    ];
    const best = pickBestGroupColumn([a, b], rows);
    expect(best?.key).toBe("a");
  });

  it("sem linhas para avaliar, mantém a ordem original (comportamento de antes)", () => {
    const a = col("a", "category");
    const b = col("b", "category");
    expect(pickBestGroupColumn([a, b], [])?.key).toBe("a");
  });
});

describe("createWidget/buildDefaultWidgets com dados reais (heurística de coluna quase vazia)", () => {
  // Simula o caso relatado: planilha de amortização (Price/SAC) com uma
  // coluna categórica praticamente vazia ("coluna_6") aparecendo antes de
  // uma coluna categórica de verdade, e sem coluna de data, mas com uma
  // coluna numérica de parcela para servir de eixo X.
  const columns: Column[] = [
    col("coluna_6", "category"),
    col("status_parcela", "category"),
    col("parcela", "number"),
    col("valor_parcela", "currency"),
  ];
  const rows: Row[] = Array.from({ length: 24 }, (_, i) => ({
    coluna_6: i === 0 ? "resíduo" : null, // quase inteiramente vazia
    status_parcela: i < 20 ? "Em dia" : "Atrasada",
    parcela: i + 1,
    valor_parcela: 1500,
  }));

  it("createWidget (ranking) não usa a coluna quase vazia como agrupamento", () => {
    const w = createWidget("ranking", columns, undefined, rows);
    expect(w.groupKey).toBe("status_parcela");
  });

  it("createWidget (área) usa a coluna de parcela como eixo X quando não há data", () => {
    const w = createWidget("area", columns, undefined, rows);
    expect(w.groupKey).toBe("parcela");
  });

  it("buildDefaultWidgets não coloca a coluna quase vazia na barra/pizza padrão", () => {
    const widgets = buildDefaultWidgets(columns, undefined, rows);
    const bar = widgets.find((w) => w.type === "bar");
    const pie = widgets.find((w) => w.type === "pie");
    expect(bar?.groupKey).toBe("status_parcela");
    expect(pie?.groupKey).toBe("status_parcela");
  });
});

describe("createWidget/buildDefaultWidgets ignoram coluna numérica 100% vazia como métrica padrão", () => {
  const columnsWithEmptyMetric: Column[] = [
    col("foto", "number"),
    col("quantidade", "number"),
    col("cliente", "category"),
  ];
  const rowsWithEmptyMetric: Row[] = Array.from({ length: 10 }, (_, i) => ({
    foto: null,
    quantidade: i + 1,
    cliente: i % 2 === 0 ? "Ana" : "Beto",
  }));

  it("createWidget (metric) usa a primeira coluna numérica com dado real, não a vazia", () => {
    const w = createWidget("metric", columnsWithEmptyMetric, undefined, rowsWithEmptyMetric);
    expect(w.metricKey).toBe("quantidade");
  });

  it("createWidget (bar) usa a coluna numérica preenchida como valor padrão", () => {
    const w = createWidget("bar", columnsWithEmptyMetric, undefined, rowsWithEmptyMetric);
    expect(w.valueKey).toBe("quantidade");
  });

  it("cai na coluna vazia só se não houver nenhuma numérica preenchida", () => {
    const onlyEmpty: Column[] = [col("foto", "number"), col("cliente", "category")];
    const rows: Row[] = Array.from({ length: 5 }, () => ({ foto: null, cliente: "Ana" }));
    const w = createWidget("metric", onlyEmpty, undefined, rows);
    expect(w.metricKey).toBe("foto");
  });
});

describe("columnDragType/columnDropAccepted (arrastar coluna para slot de gráfico)", () => {
  it("gera um tipo MIME diferente por Kind, para o slot saber aceitar ou não durante o dragover", () => {
    expect(columnDragType("category")).not.toBe(columnDragType("number"));
    expect(columnDragType("date")).toBe("application/x-oliqualidade-col-date");
  });

  it("aceita quando o dataTransfer contém um dos tipos aceitos pelo slot", () => {
    const types = [columnDragType("category")];
    expect(columnDropAccepted(types, groupableKinds)).toBe(true);
    expect(columnDropAccepted(types, numericKinds)).toBe(false);
  });

  it("slot de coluna numérica aceita moeda/percentual/número, não categoria/texto/data", () => {
    for (const k of numericKinds) {
      expect(columnDropAccepted([columnDragType(k)], numericKinds)).toBe(true);
    }
    for (const k of groupableKinds) {
      expect(columnDropAccepted([columnDragType(k)], numericKinds)).toBe(false);
    }
  });

  it("nenhum tipo relevante presente: não aceita", () => {
    expect(columnDropAccepted(["text/plain"], groupableKinds)).toBe(false);
  });
});

describe("draggedColumnKind (para o aviso de tipo incompatível durante o dragover)", () => {
  it("identifica o Kind embutido no tipo MIME sintético", () => {
    expect(draggedColumnKind([columnDragType("percentage")])).toBe("percentage");
  });

  it("retorna null quando não há nenhum tipo de coluna presente, ex.: arrastar um widget", () => {
    expect(draggedColumnKind(["text/plain"])).toBeNull();
  });

  it("ignora os demais tipos presentes e encontra o de coluna entre eles", () => {
    expect(draggedColumnKind(["text/plain", columnDragType("date")])).toBe("date");
  });
});

describe("createWidget, novos tipos", () => {
  const columns: Column[] = [
    col("receita", "currency"),
    col("nota", "number"),
    col("categoria", "category"),
    col("data_venda", "date"),
  ];

  it("métrica com tendência usa a primeira coluna numérica e a coluna de data para o sparkline", () => {
    const w = createWidget("metric-trend", columns);
    expect(w.metricKey).toBe("receita");
    expect(w.groupKey).toBe("data_venda");
    expect(w.span).toBe(1);
    expect(w.size).toBe("sm");
  });

  it("widget de pasta monitorada nasce compacto e sem depender de colunas", () => {
    const w = createWidget("folder-files", []);
    expect(w.span).toBe(1);
    expect(w.size).toBe("sm");
  });

  it("cronograma visual detecta meses, item e situação sem depender do nome da planilha", () => {
    const scheduleColumns: Column[] = [
      col("ponto", "category"),
      col("status", "category"),
      col("jan", "category"),
      { ...col("jun", "category"), label: "2ª coleta — Junho — Resultado" },
      col("observacao", "text"),
    ];
    const rows: Row[] = [
      { ponto: "Poço", status: "Planejado", jan: "M", jun: "T", observacao: null },
      { ponto: "Refeitório", status: "Executado", jan: "C", jun: null, observacao: null },
    ];

    expect(schedulePeriodColumns(scheduleColumns).map((column) => column.key)).toEqual([
      "jan",
      "jun",
    ]);
    const widget = createWidget("schedule-heatmap", scheduleColumns, undefined, rows);
    expect(widget).toMatchObject({
      type: "schedule-heatmap",
      groupKey: "ponto",
      statusKey: "status",
      periodKeys: ["jan", "jun"],
      span: 3,
      size: "md",
    });
  });

  it("cronograma visual reconhece períodos mensais sem exigir um dia inventado", () => {
    const scheduleColumns: Column[] = [
      col("Ponto / Item", "category"),
      col("jun/2025", "number"),
      col("set/2025", "number"),
      col("mar/2026", "number"),
      col("Máx.", "number"),
    ];

    expect(schedulePeriodColumns(scheduleColumns).map((column) => column.key)).toEqual([
      "jun/2025",
      "set/2025",
      "mar/2026",
    ]);
  });

  it("cronograma reconhece mês por extenso seguido de ano", () => {
    const scheduleColumns: Column[] = [
      col("Ponto / Item", "category"),
      col("mar/2026", "number"),
      col("Abril-26", "number"),
      col("Máx.", "number"),
    ];

    expect(schedulePeriodColumns(scheduleColumns).map((column) => column.key)).toEqual([
      "mar/2026",
      "Abril-26",
    ]);
  });

  it("cronograma preserva limites e contexto fora das colunas de período", () => {
    const scheduleColumns: Column[] = [
      col("Ponto", "category"),
      col("Análise", "text"),
      col("Responsável", "text"),
      col("jun/2025", "number"),
      col("set/2025", "number"),
      col("Máx.", "number"),
    ];
    const rows: Row[] = [
      {
        Ponto: "Bancada CQ",
        Análise: "Bolores e leveduras",
        Responsável: "Laboratório",
        "jun/2025": null,
        "set/2025": null,
        "Máx.": 25,
      },
    ];
    expect(
      scheduleDetailColumns(scheduleColumns, ["jun/2025", "set/2025"], rows, "Ponto").map(
        (column) => column.key,
      ),
    ).toEqual(["Análise", "Responsável", "Máx."]);
    expect(createWidget("schedule-heatmap", scheduleColumns, undefined, rows).detailKeys).toEqual([
      "Análise",
      "Responsável",
      "Máx.",
    ]);
  });

  it("preserva até oito informações importantes do cronograma", () => {
    const scheduleColumns: Column[] = [
      col("Ponto", "category"),
      col("Análise", "text"),
      col("Responsável", "text"),
      col("Método", "text"),
      col("Unidade", "text"),
      col("Periodicidade", "text"),
      col("Máx.", "number"),
      col("Observação", "text"),
      col("Registro", "text"),
      col("jun/2025", "number"),
      col("set/2025", "number"),
    ];
    const rows: Row[] = [
      {
        Ponto: "Torneira",
        Análise: "Cor",
        Responsável: "Qualidade",
        Método: "Interno",
        Unidade: "uT",
        Periodicidade: "Mensal",
        "Máx.": 5,
        Observação: "Revisar laudo",
        Registro: "FRS-001",
        "jun/2025": 4,
        "set/2025": null,
      },
    ];

    expect(
      scheduleDetailColumns(scheduleColumns, ["jun/2025", "set/2025"], rows, "Ponto").map(
        (column) => column.key,
      ),
    ).toEqual([
      "Análise",
      "Responsável",
      "Método",
      "Unidade",
      "Periodicidade",
      "Máx.",
      "Observação",
      "Registro",
    ]);
  });

  it("não interpreta uma coluna numérica Resultado como status do cronograma", () => {
    const scheduleColumns: Column[] = [
      col("Ponto", "category"),
      col("Resultado", "number"),
      col("jun/2025", "number"),
      col("set/2025", "number"),
    ];
    const rows: Row[] = [{ Ponto: "Bancada CQ", Resultado: 4, "jun/2025": 4, "set/2025": null }];
    const periods = ["jun/2025", "set/2025"];
    expect(scheduleStatusColumn(scheduleColumns, periods)).toBeUndefined();
    expect(createWidget("schedule-heatmap", scheduleColumns, undefined, rows).detailKeys).toContain(
      "Resultado",
    );
  });

  it("cronograma usa Bloco como seção e não repete essa coluna nos detalhes", () => {
    const scheduleColumns: Column[] = [
      col("Bloco", "category"),
      col("Ponto / Item", "category"),
      col("jun/2025", "number"),
      col("set/2025", "number"),
      col("Máx.", "number"),
    ];
    const rows: Row[] = [
      {
        Bloco: "Ar ambiente",
        "Ponto / Item": "Laboratório CQ",
        "jun/2025": 4,
        "set/2025": null,
        "Máx.": 25,
      },
    ];
    expect(
      scheduleSectionColumn(scheduleColumns, ["jun/2025", "set/2025"], "Ponto / Item")?.key,
    ).toBe("Bloco");
    const widget = createWidget("schedule-heatmap", scheduleColumns, undefined, rows);
    expect(widget.sectionKey).toBe("Bloco");
    expect(widget.detailKeys).toEqual(["Máx."]);
  });

  it("área usa data como agrupamento padrão, como a linha", () => {
    const w = createWidget("area", columns);
    expect(w.groupKey).toBe("data_venda");
    expect(w.valueKey).toBe("receita");
    expect(w.op).toBe("sum");
    expect(w.span).toBe(3);
  });

  it("ranking define topN padrão de 5 e agrupa por categoria", () => {
    const w = createWidget("ranking", columns);
    expect(w.topN).toBe(5);
    expect(w.groupKey).toBe("categoria");
    expect(w.span).toBe(2);
  });

  it("avaliação define escala máxima padrão de 5", () => {
    const w = createWidget("rating", columns);
    expect(w.metricKey).toBe("receita");
    expect(w.scaleMax).toBe(5);
    expect(w.span).toBe(1);
    expect(w.size).toBe("sm");
  });
});

describe("createWidget, mapa prefere uma coluna geográfica de verdade", () => {
  const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
    quantidade: i + 1,
    vendedor: `Vendedor ${i}`,
    id_venda: `V${i.toString().padStart(4, "0")}`,
    cidade: i % 2 === 0 ? "São Paulo" : "Curitiba",
  }));

  it("escolhe a coluna de cidade em vez da primeira categoria disponível (vendedor)", () => {
    // Reproduz o bug relatado: sem essa preferência, o mapa caía direto na
    // primeira coluna categórica (aqui "vendedor"), a Nominatim nunca acha
    // nome de pessoa como local, e o mapa fica vazio sem nenhum indício de
    // que a coluna escolhida automaticamente era o problema.
    const columns: Column[] = [
      col("quantidade", "number"),
      col("vendedor", "category"),
      col("id_venda", "category"),
      col("cidade", "category"),
    ];
    const w = createWidget("map", columns, undefined, rows);
    expect(w.groupKey).toBe("cidade");
    expect(w.valueKey).toBe("quantidade");
  });

  it("sem nenhuma coluna com nome de local, cai de volta na melhor categoria disponível", () => {
    const columns: Column[] = [
      col("quantidade", "number"),
      col("vendedor", "category"),
      col("id_venda", "category"),
    ];
    const w = createWidget("map", columns, undefined, rows);
    expect(w.groupKey).toBe("vendedor");
  });

  it("reconhece variações comuns de nome de coluna geográfica (estado, UF, país, região)", () => {
    for (const key of ["estado", "uf", "pais", "regiao", "município", "bairro"]) {
      const columns: Column[] = [
        col("quantidade", "number"),
        col("vendedor", "category"),
        col(key, "category"),
      ];
      const w = createWidget("map", columns, undefined, rows);
      expect(w.groupKey).toBe(key);
    }
  });
});
