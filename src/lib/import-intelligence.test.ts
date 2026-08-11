import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  diagnoseImportedSheet,
  normalizeImportedValue,
  normalizeRows,
  sanitizeRowsForAi,
} from "@/lib/import-intelligence";

const sheet = (aoa: (string | number | null)[][]) => XLSX.utils.aoa_to_sheet(aoa);

describe("import intelligence", () => {
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

  it("calcula qualidade por coluna e geral", () => {
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
    expect(diagnostics.columns.find((c) => c.key === "Valor")?.qualityScore).toBeLessThan(100);
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
    expect(result.rows[0]?.Valor).toBe(2500);
    expect(result.rows[0]?.Ativo).toBe(false);
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
  expect(summary.supported).toBe(1);
  expect(summary.ranges).toBe(1);
  expect(summary.unsupported).toBe(1);
});
