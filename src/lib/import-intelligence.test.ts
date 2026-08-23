import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildSheetConfidenceMatrix,
  confidenceLevelFor,
  diagnoseImportedSheet,
  getFormulaSummary,
  normalizeImportedValue,
  normalizeRows,
  sanitizeRowsForAi,
} from "@/lib/import-intelligence";
import type { WorksheetWithAdvancedMetadata } from "@/lib/workbook-metadata";

const sheet = (aoa: (string | number | null)[][]) => XLSX.utils.aoa_to_sheet(aoa);

describe("import intelligence", () => {
  it("preserva comentários do Excel e observações soltas sem transformá-los em registros", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
      [null, null],
      ["Observações: revisar o plano após qualquer reincidência detectada.", null],
    ]);
    ws["A2"]!.c = [{ a: "sheetjsghost", t: "Inaly Nascimento:\nConferir o laudo mensal" }];
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.sourceNotes).toEqual([
      {
        address: "A2",
        author: "Inaly Nascimento",
        text: "Conferir o laudo mensal",
        kind: "comment",
      },
      {
        address: "A4",
        text: "revisar o plano após qualquer reincidência detectada.",
        kind: "observation",
      },
    ]);
  });

  it("expõe o inventário de hyperlinks do Excel anexado pelo leitor OOXML", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
    ]);
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [{ address: "A2", target: "https://exemplo.com/poco", tooltip: "Ver relatório" }],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.hyperlinks).toEqual([
      { address: "A2", target: "https://exemplo.com/poco", tooltip: "Ver relatório" },
    ]);
    expect(diagnostics.warnings).toContain("1 hyperlink(s) do Excel preservado(s)");
  });

  it("expõe nomes definidos e referências a arquivos externos anexados pelo leitor OOXML", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
    ]);
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [{ name: "PrecoPoco", refersTo: "Dados!$B$2", scope: null }],
      externalLinks: [{ target: "https://exemplo.com/planilha-externa.xlsx" }],
      dataValidations: [],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.definedNames).toEqual([
      { name: "PrecoPoco", refersTo: "Dados!$B$2", scope: null },
    ]);
    expect(diagnostics.externalLinks).toEqual([
      { target: "https://exemplo.com/planilha-externa.xlsx" },
    ]);
    expect(diagnostics.warnings).toContain("1 nome(s) definido(s) detectado(s)");
    expect(diagnostics.warnings).toContain("1 referência(s) a arquivo(s) externo(s) detectada(s)");
  });

  it("expõe validações de dados do Excel anexadas pelo leitor OOXML", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
    ]);
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [],
      externalLinks: [],
      dataValidations: [
        {
          range: "B2:B10",
          type: "list",
          allowBlank: true,
          formula1: '"Baixo,Médio,Alto"',
          promptTitle: "Selecione o nível",
          prompt: "Escolha uma das opções da lista",
        },
      ],
      hasVbaMacros: false,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.dataValidations).toEqual([
      {
        range: "B2:B10",
        type: "list",
        allowBlank: true,
        formula1: '"Baixo,Médio,Alto"',
        promptTitle: "Selecione o nível",
        prompt: "Escolha uma das opções da lista",
      },
    ]);
    expect(diagnostics.warnings).toContain(
      "1 regra(s) de validação de dados do Excel detectada(s)",
    );
  });

  it("expõe a detecção de macros VBA anexada pelo leitor OOXML", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
    ]);
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: true,
      images: [],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.hasVbaMacros).toBe(true);
    expect(diagnostics.warnings.some((warning) => warning.includes("macros VBA"))).toBe(true);
  });

  it("expõe imagens embutidas anexadas pelo leitor OOXML", () => {
    const ws = sheet([
      ["Item", "Valor"],
      ["Poço", 5],
    ]);
    (ws as WorksheetWithAdvancedMetadata)["!oliAdvanced"] = {
      structuredTables: [],
      pivotTables: [],
      autoFilterRange: null,
      comments: [],
      hyperlinks: [],
      definedNames: [],
      externalLinks: [],
      dataValidations: [],
      hasVbaMacros: false,
      images: [{ name: "Logo", anchor: "A1", format: "PNG" }],
      shapes: [],
      charts: [],
      cellFills: [],
    };
    const diagnostics = diagnoseImportedSheet(ws, [{ Item: "Poço", Valor: 5 }]);
    expect(diagnostics.images).toEqual([{ name: "Logo", anchor: "A1", format: "PNG" }]);
    expect(diagnostics.warnings).toContain("1 imagem(ns) embutida(s) detectada(s)");
  });

  it("aumenta a confiança quando uma estrutura defeituosa é recuperada com evidências", () => {
    const ws = sheet([
      ["RELATÓRIO DE VENDAS", null, null],
      [null, null, null],
      ["Produto", "Região", "Valor"],
      ["Bolo", "Recife", 40],
      ["Açaí", "Olinda", 55],
      ["Café", "Recife", 25],
    ]);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    const diagnostics = diagnoseImportedSheet(ws, [
      { Produto: "Bolo", Região: "Recife", Valor: 40 },
      { Produto: "Açaí", Região: "Olinda", Valor: 55 },
      { Produto: "Café", Região: "Recife", Valor: 25 },
    ]);
    expect(diagnostics.confidence).toBeGreaterThan(diagnostics.baseConfidence);
    expect(diagnostics.recoveryGain).toBeGreaterThan(0);
    expect(diagnostics.confidenceReasons).toContain(
      "cabeçalho recuperado com segurança na linha 3",
    );
    expect(diagnostics.confidenceReasons).toContain("células mescladas foram reconstruídas");
  });

  it("não infla a confiança quando ainda existem várias regiões independentes", () => {
    const ws = sheet([
      ["Cliente", "Valor", null, null, "Produto", "Qtd"],
      ["Ana", 10, null, null, "A", 2],
      ["Beto", 20, null, null, "B", 3],
      ["Caio", 30, null, null, "C", 4],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Cliente: "Ana", Valor: 10 },
      { Cliente: "Beto", Valor: 20 },
      { Cliente: "Caio", Valor: 30 },
    ]);
    expect(diagnostics.confidenceReasons).toContain(
      "há regiões independentes que ainda exigem confirmação",
    );
    expect(diagnostics.confidence).toBeLessThan(90);
  });

  it("trata números de controle como identificadores, não métricas", () => {
    const ws = sheet([
      ["Código", "Nº 1", "Nº 2", "Data G", "Responsável"],
      ["50026804", "39960", "89798781", "20/05/2026", "FERNANDO"],
      ["50041209", "39963", "89799261", "01/06/2026", "CRISTIANO"],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      {
        Código: "50026804",
        "Nº 1": "39960",
        "Nº 2": "89798781",
        "Data G": "20/05/2026",
        Responsável: "FERNANDO",
      },
      {
        Código: "50041209",
        "Nº 1": "39963",
        "Nº 2": "89799261",
        "Data G": "01/06/2026",
        Responsável: "CRISTIANO",
      },
    ]);
    expect(diagnostics.columns.find((column) => column.key === "Código")?.kind).toBe("id");
    expect(diagnostics.columns.find((column) => column.key === "Nº 1")?.kind).toBe("id");
    expect(diagnostics.columns.find((column) => column.key === "Nº 2")?.kind).toBe("id");
  });
  it("detecta tipos e qualidade básicos", () => {
    const ws = sheet([
      ["Cliente", "CPF", "E-mail", "Data", "Valor", "Taxa"],
      ["Ana", "123.456.789-00", "ana@example.com", "10/08/2026", "R$ 1.234,50", "12%"],
      ["Beto", "987.654.321-00", "beto@example.com", "11/08/2026", "R$ 900,00", "8%"],
    ]);
    const rows = [
      {
        Cliente: "Ana",
        CPF: "123.456.789-00",
        "E-mail": "ana@example.com",
        Data: "10/08/2026",
        Valor: "R$ 1.234,50",
        Taxa: "12%",
      },
      {
        Cliente: "Beto",
        CPF: "987.654.321-00",
        "E-mail": "beto@example.com",
        Data: "11/08/2026",
        Valor: "R$ 900,00",
        Taxa: "8%",
      },
    ];
    const diagnostics = diagnoseImportedSheet(ws, rows);
    expect(diagnostics.columnCount).toBe(6);
    expect(diagnostics.columns.find((c) => c.key === "CPF")?.kind).toBe("cpf");
    expect(diagnostics.columns.find((c) => c.key === "E-mail")?.kind).toBe("email");
    expect(diagnostics.columns.find((c) => c.key === "Valor")?.kind).toBe("currency");
    expect(diagnostics.columns.find((c) => c.key === "Taxa")?.kind).toBe("percentage");
    expect(diagnostics.columns.find((c) => c.key === "CPF")?.sensitive).toBe(true);
  });

  it("preserva linhas e mascara campos sensíveis para contexto de IA", () => {
    const ws = sheet([
      ["Nome", "CPF", "Cidade"],
      ["Ana", "12345678900", "Recife"],
    ]);
    const rows = [{ Nome: "Ana", CPF: "12345678900", Cidade: "Recife" }];
    const diagnostics = diagnoseImportedSheet(ws, rows);
    const sanitized = sanitizeRowsForAi(rows, diagnostics.columns);
    expect(sanitized[0]).toEqual({
      Nome: "Ana",
      CPF: "[DADO_SENSIVEL_REMOVIDO]",
      Cidade: "Recife",
    });
  });

  it("detecta duplicidade de linhas", () => {
    const ws = sheet([
      ["Produto", "Valor"],
      ["A", 10],
      ["A", 10],
      ["B", 20],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Produto: "A", Valor: 10 },
      { Produto: "A", Valor: 10 },
      { Produto: "B", Valor: 20 },
    ]);
    expect(diagnostics.duplicateRows).toBe(1);
    expect(diagnostics.warnings.some((w) => w.includes("duplicada"))).toBe(true);
  });
  it("detecta regiões independentes lado a lado", () => {
    const ws = sheet([
      ["Cliente", "Valor", null, null, "Produto", "Qtd"],
      ["Ana", 10, null, null, "A", 2],
      ["Beto", 20, null, null, "B", 3],
      ["Caio", 30, null, null, "C", 4],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Cliente: "Ana", Valor: 10 },
      { Cliente: "Beto", Valor: 20 },
      { Cliente: "Caio", Valor: 30 },
    ]);
    expect(diagnostics.tableRegions.length).toBeGreaterThanOrEqual(2);
  });

  it("marca transformações estruturais para revisão", () => {
    const ws = sheet([
      ["Produto", "Valor"],
      ["A", 10],
      ["A", 10],
      ["B", 20],
    ]);
    ws["!rows"] = [{}, { hidden: true }, {}, {}];
    const diagnostics = diagnoseImportedSheet(ws, [
      { Produto: "A", Valor: 10 },
      { Produto: "A", Valor: 10 },
      { Produto: "B", Valor: 20 },
    ]);
    expect(diagnostics.transformations.some((item) => item.includes("duplicada"))).toBe(true);
  });
});

describe("import intelligence - estrutura e qualidade", () => {
  it("marca coluna genérica como sensível pelo conteúdo", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Informação"], ["123.456.789-00"], ["987.654.321-00"]]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Informação: "123.456.789-00" },
      { Informação: "987.654.321-00" },
    ]);
    expect(diagnostics.columns[0]?.sensitive).toBe(true);
  });
  it("estima linha do cabeçalho quando existem metadados antes da tabela", () => {
    const ws = sheet([
      ["Relatório mensal", null, null],
      ["Empresa", "XPTO", null],
      ["Data", "Produto", "Valor"],
      ["01/08/2026", "A", "R$ 100,00"],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Data: "01/08/2026", Produto: "A", Valor: "R$ 100,00" },
    ]);
    expect(diagnostics.header.row).toBeGreaterThan(1);
    expect(diagnostics.header.confidence).toBeGreaterThan(0.5);
  });

  it("separa consistência de preenchimento", () => {
    const ws = sheet([
      ["Cliente", "Valor"],
      ["Ana", "R$ 100,00"],
      ["Beto", "R$ 200,00"],
      ["Caio", ""],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Cliente: "Ana", Valor: "R$ 100,00" },
      { Cliente: "Beto", Valor: "R$ 200,00" },
      { Cliente: "Caio", Valor: "" },
    ]);
    expect(diagnostics.qualityScore).toBeGreaterThan(0);
    expect(diagnostics.columns.find((c) => c.key === "Valor")?.qualityScore).toBe(100);
  });

  it("reduz a consistência quando uma coluna mistura representações", () => {
    const ws = sheet([["Valor"], [10], [20], ["erro"]]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Valor: 10 },
      { Valor: 20 },
      { Valor: "erro" },
    ]);
    expect(diagnostics.columns[0]?.qualityScore).toBe(67);
  });

  it("não trata períodos futuros vazios de cronograma como inconsistência", () => {
    const ws = sheet([
      ["Item", "jan", "fev", "mar"],
      ["Água", "M", null, null],
      ["Ar", null, null, "T"],
      ["Superfície", null, null, null],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Item: "Água", jan: "M", fev: null, mar: null },
      { Item: "Ar", jan: null, fev: null, mar: "T" },
      { Item: "Superfície", jan: null, fev: null, mar: null },
    ]);
    expect(diagnostics.qualityScore).toBe(100);
    expect(diagnostics.interpretationScore).toBe(100);
    expect(diagnostics.columns.flatMap((column) => column.warnings)).not.toContain(
      "muitos valores ausentes",
    );
  });
});

describe("normalização de valores importados", () => {
  it("normaliza moeda e número no padrão brasileiro", () => {
    expect(normalizeImportedValue("R$ 1.234,56", "currency").value).toBe(1234.56);
    expect(normalizeImportedValue("1.234,56", "number").value).toBe(1234.56);
  });

  it("normaliza percentual sem perder a semântica", () => {
    expect(normalizeImportedValue("12,5%", "percentage").value).toBe(0.125);
  });

  it("normaliza identificadores sem tratá-los como números", () => {
    expect(normalizeImportedValue("123.456.789-00", "cpf").value).toBe("12345678900");
  });

  it("normaliza booleanos e preserva valores desconhecidos", () => {
    expect(normalizeImportedValue("Sim", "boolean").value).toBe(true);
    expect(normalizeImportedValue("qualquer coisa", "boolean").value).toBe("qualquer coisa");
  });

  it("normaliza linhas usando os tipos detectados", () => {
    const result = normalizeRows(
      [{ Valor: "R$ 2.500,00", Ativo: "Não" }],
      [
        { key: "Valor", kind: "currency" },
        { key: "Ativo", kind: "boolean" },
      ],
    );
    expect(result.rows[0]?.["Valor"]).toBe(2500);
    expect(result.rows[0]?.["Ativo"]).toBe(false);
    expect(result.changes).toBe(2);
  });
});

it("classifica fórmulas locais, intervalos e referências entre abas", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["A", "B", "Total", "Outro"],
    [2, 3, { f: "A2+B2" }, { f: "SUM(A2:A3)" }],
  ]);
  ws["C2"] = { f: "A2+B2" };
  ws["D2"] = { f: "SUM(A2:A3)" };
  const rows = [{ A: 2, B: 3, Total: 5, Outro: 5 }];
  const diagnostics = diagnoseImportedSheet(ws, rows);
  const summary = getFormulaSummary(diagnostics);
  expect(summary.total).toBe(2);
  expect(summary.supported).toBe(2);
  expect(summary.ranges).toBe(1);
  expect(summary.unsupported).toBe(0);
});

it("classifica condições e agregações condicionais locais como compatíveis", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Status", "Valor", "Soma", "Regra"],
    ["Aprovado", 10, null, null],
    ["Reprovado", 20, null, null],
  ]);
  ws["C2"] = { f: 'SUMIF(A2:A3,"Aprovado",B2:B3)' };
  ws["D2"] = { f: "IF(AND(B2>0,B2<15),1,0)" };
  const diagnostics = diagnoseImportedSheet(ws, [
    { Status: "Aprovado", Valor: 10, Soma: 10, Regra: 1 },
  ]);
  const summary = getFormulaSummary(diagnostics);
  expect(summary).toMatchObject({ total: 2, supported: 2, unsupported: 0 });
});

it("separa fórmula incompatível com valor armazenado de resultado realmente indisponível", () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Código", "Tabela", "Busca", "Outra aba"],
    ["A", 42, null, null],
  ]);
  ws["C2"] = { f: "VLOOKUP(A2,A1:B2,2,FALSE)", v: 42, t: "n" };
  ws["D2"] = { f: "Resumo!A1" };
  ws["!ref"] = "A1:D2";
  const diagnostics = diagnoseImportedSheet(ws, [
    { Código: "A", Tabela: 42, Busca: 42, "Outra aba": null },
  ]);

  expect(diagnostics.formulaDiagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ address: "C2", resolution: "stored-value" }),
      expect.objectContaining({ address: "D2", resolution: "unavailable" }),
    ]),
  );
  expect(getFormulaSummary(diagnostics)).toMatchObject({
    total: 2,
    unsupported: 2,
    storedValues: 1,
    unavailableValues: 1,
  });
});

describe("matriz de confiança por aba", () => {
  it("classifica cada aba em alta/média/baixa a partir da confiança já calculada, sem recalcular nada", () => {
    const wsAlta = sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
      ["Torta", 18],
    ]);
    const wsBaixa = sheet([
      ["A", "B", "C"],
      [1, null, "x"],
      [null, 2, null],
    ]);
    const diagnosticsAlta = diagnoseImportedSheet(wsAlta, [
      { Produto: "Bolo", Valor: 42 },
      { Produto: "Torta", Valor: 18 },
    ]);
    const diagnosticsBaixa = diagnoseImportedSheet(wsBaixa, [{ A: 1, B: null, C: "x" }]);

    const matrix = buildSheetConfidenceMatrix([
      { name: "Vendas", diagnostics: diagnosticsAlta },
      { name: "Rascunho", diagnostics: diagnosticsBaixa },
      { name: "Sem dado" },
    ]);

    expect(matrix).toHaveLength(3);
    expect(matrix[0]).toMatchObject({
      name: "Vendas",
      confidence: diagnosticsAlta.confidence,
      reasons: diagnosticsAlta.confidenceReasons,
    });
    expect(matrix[0]!.level).toBe(diagnosticsAlta.confidence >= 85 ? "alta" : "média");
    expect(matrix[1]).toMatchObject({
      name: "Rascunho",
      confidence: diagnosticsBaixa.confidence,
    });
    expect(matrix[2]).toEqual({
      name: "Sem dado",
      confidence: null,
      level: "sem diagnóstico",
      reasons: [],
      readerDivergenceCount: 0,
    });
  });

  it("conta divergências do leitor por aba sem misturar com a de outra aba", () => {
    const ws = sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [{ Produto: "Bolo", Valor: 42 }]);
    diagnostics.readerDivergences = [
      {
        sheet: "Vendas",
        address: "A2",
        primary: "Bolo",
        independent: "Bolinho",
        severity: "warning",
        repaired: false,
      },
    ];

    const matrix = buildSheetConfidenceMatrix([{ name: "Vendas", diagnostics }]);

    expect(matrix[0]!.readerDivergenceCount).toBe(1);
  });
});

describe("confidenceLevelFor", () => {
  it("usa os mesmos limiares (85/60) reaproveitados pela matriz de confiança por aba", () => {
    expect(confidenceLevelFor(100)).toBe("alta");
    expect(confidenceLevelFor(85)).toBe("alta");
    expect(confidenceLevelFor(84)).toBe("média");
    expect(confidenceLevelFor(60)).toBe("média");
    expect(confidenceLevelFor(59)).toBe("baixa");
    expect(confidenceLevelFor(0)).toBe("baixa");
  });
});

describe("confiança por coluna (ColumnDiagnostic.level)", () => {
  it("classifica uma coluna limpa e consistente como alta", () => {
    const ws = sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
      ["Torta", 18],
      ["Pudim", 30],
      ["Brigadeiro", 12],
      ["Cocada", 25],
    ]);
    const diagnostics = diagnoseImportedSheet(ws, [
      { Produto: "Bolo", Valor: 42 },
      { Produto: "Torta", Valor: 18 },
      { Produto: "Pudim", Valor: 30 },
      { Produto: "Brigadeiro", Valor: 12 },
      { Produto: "Cocada", Valor: 25 },
    ]);
    const valor = diagnostics.columns.find((c) => c.key === "Valor");
    expect(valor?.warnings).toEqual([]);
    expect(valor?.level).toBe("alta");
  });

  it("nunca mostra alta quando a coluna tem um aviso explícito, mesmo com score combinado alto", () => {
    // 8 linhas, 2 preenchidas com texto uniforme e 6 ausentes (>20% de
    // faltantes) — dispara "muitos valores ausentes" mesmo com as duas
    // linhas preenchidas sendo perfeitamente consistentes entre si
    // (qualityScore 100), o que sozinho já classificaria como alta.
    const ws = sheet([
      ["Observacao"],
      ["Conferido"],
      ["Conferido"],
      [null],
      [null],
      [null],
      [null],
      [null],
      [null],
    ]);
    const rows = [
      { Observacao: "Conferido" },
      { Observacao: "Conferido" },
      { Observacao: null },
      { Observacao: null },
      { Observacao: null },
      { Observacao: null },
      { Observacao: null },
      { Observacao: null },
    ];
    const diagnostics = diagnoseImportedSheet(ws, rows);
    const observacao = diagnostics.columns.find((c) => c.key === "Observacao");
    expect(observacao?.warnings).toContain("muitos valores ausentes");
    expect(observacao?.level).not.toBe("alta");
  });

  it("classifica uma coluna com representações misturadas e muita ausência como baixa", () => {
    const ws = sheet([
      ["X"],
      ["#N/A"],
      ["1,5"],
      ["dois"],
      ["#REF!"],
      [null],
      [null],
      [null],
      ["3"],
    ]);
    const rows = [
      { X: "#N/A" },
      { X: "1,5" },
      { X: "dois" },
      { X: "#REF!" },
      { X: null },
      { X: null },
      { X: null },
      { X: "3" },
    ];
    const diagnostics = diagnoseImportedSheet(ws, rows);
    const x = diagnostics.columns.find((c) => c.key === "X");
    expect(x?.level).toBe("baixa");
  });
});
