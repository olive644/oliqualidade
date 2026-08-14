import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { strToU8, zipSync } from "fflate";

import {
  detectDelimiter,
  readWorkbookBytes,
  readWorkbookBytesWithEngine,
  validateWorkbookComplexity,
  validateZipWorkbook,
} from "@/lib/workbook-reader";
import { inspectOoxml } from "@/lib/ooxml-reader";
import { registerWasmWorkbookReader } from "@/lib/workbook-reading-engine";

describe("leitor universal de planilhas", () => {
  it("produz relatório do motor e mantém o leitor verificado para OOXML", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx");

    expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
    expect(result.report).toMatchObject({
      reader: "sheetjs-verified",
      format: "xlsx",
      sheets: 1,
      fallbackUsed: false,
    });
    expect(result.report.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("executa o inventário WASM em shadow mode sem substituir as planilhas", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const inspection = inspectOoxml(bytes);
    registerWasmWorkbookReader({
      inventory: async () => ({
        schemaVersion: "3.0.0",
        sheets: [...inspection.sheets].map(([name, cells]) => ({
          name,
          mergedRanges: inspection.structures.get(name)?.mergedRanges ?? [],
          hiddenRows: inspection.structures.get(name)?.hiddenRows ?? [],
          hiddenColumns: inspection.structures.get(name)?.hiddenColumns ?? [],
          cells: [...cells.values()],
        })),
      }),
    });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx");
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
      expect(result.report).toMatchObject({
        reader: "sheetjs-verified",
        wasmAvailable: true,
        wasmShadowStatus: "matched",
        wasmDivergentCells: 0,
        wasmSchemaVersion: "3.0.0",
      });
      expect(result.report.wasmComparedCells).toBeGreaterThan(0);
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("verifica o XLSX no modo candidato somente quando o formato foi liberado", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const inspection = inspectOoxml(bytes);
    registerWasmWorkbookReader({
      inventory: async () => ({
        schemaVersion: "3.0.0",
        sheets: [...inspection.sheets].map(([name, cells]) => ({
          name,
          mergedRanges: inspection.structures.get(name)?.mergedRanges ?? [],
          hiddenRows: inspection.structures.get(name)?.hiddenRows ?? [],
          hiddenColumns: inspection.structures.get(name)?.hiddenColumns ?? [],
          cells: [...cells.values()],
        })),
      }),
    });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "candidate",
        wasmCandidateFormats: ["xlsx"],
        wasmSampleRate: 0,
      });
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
      expect(result.report).toMatchObject({
        reader: "sheetjs-wasm-verified",
        wasmReaderMode: "candidate",
        wasmCandidateStatus: "verified",
        wasmFallbackReason: null,
        wasmSampleRate: 1,
        wasmShadowStatus: "matched",
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("recua para o leitor validado quando o candidato diverge", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Produto"], ["Bolo"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const inspection = inspectOoxml(bytes);
    registerWasmWorkbookReader({
      inventory: async () => ({
        schemaVersion: "3.0.0",
        sheets: [...inspection.sheets].map(([name, cells]) => ({
          name,
          mergedRanges: inspection.structures.get(name)?.mergedRanges ?? [],
          hiddenRows: inspection.structures.get(name)?.hiddenRows ?? [],
          hiddenColumns: inspection.structures.get(name)?.hiddenColumns ?? [],
          cells: [...cells.values()].map((cell, index) =>
            index === 0 ? { ...cell, rawValue: "divergente" } : cell,
          ),
        })),
      }),
    });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "candidate",
        wasmCandidateFormats: ["xlsx"],
      });
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo" }]);
      expect(result.report).toMatchObject({
        reader: "sheetjs-verified",
        wasmCandidateStatus: "fallback",
        wasmFallbackReason: "diverged",
        wasmShadowStatus: "diverged",
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("recua quando o contrato do candidato é incompatível", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Produto"], ["Bolo"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const inspection = inspectOoxml(bytes);
    registerWasmWorkbookReader({
      inventory: async () => ({
        schemaVersion: "2.0.0",
        sheets: [...inspection.sheets].map(([name, cells]) => ({
          name,
          mergedRanges: inspection.structures.get(name)?.mergedRanges ?? [],
          hiddenRows: inspection.structures.get(name)?.hiddenRows ?? [],
          hiddenColumns: inspection.structures.get(name)?.hiddenColumns ?? [],
          cells: [...cells.values()],
        })),
      }),
    });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "candidate",
        wasmCandidateFormats: ["xlsx"],
      });
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo" }]);
      expect(result.report).toMatchObject({
        reader: "sheetjs-verified",
        wasmCandidateStatus: "fallback",
        wasmFallbackReason: "schema-mismatch",
        wasmShadowStatus: "matched",
        wasmSchemaVersion: "2.0.0",
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("não habilita candidato sem allowlist ou adaptador disponível", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Produto"], ["Bolo"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    registerWasmWorkbookReader(undefined);

    const notEligible = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
      wasmReaderMode: "candidate",
      wasmCandidateFormats: [],
      wasmSampleRate: 0,
    });
    expect(notEligible.report).toMatchObject({
      reader: "sheetjs-verified",
      wasmCandidateStatus: "not-eligible",
      wasmFallbackReason: null,
    });

    const unavailable = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
      wasmReaderMode: "candidate",
      wasmCandidateFormats: ["xlsx"],
    });
    expect(unavailable.report).toMatchObject({
      reader: "sheetjs-verified",
      wasmCandidateStatus: "fallback",
      wasmFallbackReason: "unavailable",
    });
  });

  it("mantém a importação quando o shadow WASM falha", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Produto"], ["Bolo"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    registerWasmWorkbookReader({ inventory: async () => Promise.reject(new Error("falha")) });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx");
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo" }]);
      expect(result.report.wasmShadowStatus).toBe("failed");
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("registra quando o arquivo fica fora da amostra WASM", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Produto"], ["Bolo"]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
    registerWasmWorkbookReader({
      inventory: async () => Promise.reject(new Error("não deve rodar")),
    });

    try {
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmSampleRate: 0,
      });
      expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo" }]);
      expect(result.report).toMatchObject({
        wasmAvailable: true,
        wasmSampleRate: 0,
        wasmShadowStatus: "sampled-out",
        wasmShadowMs: 0,
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("preserva a visibilidade das linhas do XLSX e não importa conteúdo oculto", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Item", "jun"],
      ["Visível", "T"],
      ["Oculto", "4s"],
    ]);
    worksheet["!rows"] = [{}, {}, { hidden: true }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cronograma");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [result] = readWorkbookBytes(bytes, "cronograma.xlsx");

    expect(result?.rows).toEqual([{ Item: "Visível", jun: "T" }]);
    expect(result?.audit?.hiddenRowsIgnored).toBe(1);
    expect(result?.diagnostics?.hiddenRows).toBe(1);
    expect(result?.sourceGrid?.rows[2]).toEqual(["Oculto", "4s"]);
  });
  it("bloqueia dimensões abusivas declaradas pelo arquivo", () => {
    expect(() =>
      validateWorkbookComplexity({
        SheetNames: ["Dados"],
        Sheets: { Dados: { "!ref": "A1:XFD1048576" } },
      }),
    ).toThrow("2 milhões de células");
  });
  it("detecta separadores sem contar delimitadores dentro de campos entre aspas", () => {
    expect(detectDelimiter('produto;observação;valor\nBolo;"doce, caseiro";12,50')).toBe(";");
    expect(detectDelimiter("produto\tvalor\nBolo\t12")).toBe("\t");
    expect(detectDelimiter("produto|valor\nBolo|12")).toBe("|");
    expect(detectDelimiter("Produto;Valor\nA;1.234,50\nB;2.000,00")).toBe(";");
  });

  it("lê CSV brasileiro em Windows-1252 preservando acentos e normalizando decimal", () => {
    const source = "produto;região;valor\r\nAçaí;São Paulo;1.234,50";
    const bytes = Uint8Array.from(
      [...source].map((character) => {
        const code = character.charCodeAt(0);
        const cp1252: Record<number, number> = { 227: 0xe3, 231: 0xe7, 237: 0xed };
        return cp1252[code] ?? code;
      }),
    );
    const [sheet] = readWorkbookBytes(bytes, "vendas.csv");
    expect(sheet?.rows[0]).toMatchObject({
      produto: "Açaí",
      região: "São Paulo",
      valor: 1234.5,
    });
  });

  it("não confunde vírgulas decimais com o separador do CSV brasileiro", () => {
    const source = "Produto;Valor\nA;1.234,50\nB;2.000,00";
    const [sheet] = readWorkbookBytes(new TextEncoder().encode(source), "valores.csv");
    expect(sheet?.rows).toEqual([
      { Produto: "A", Valor: 1234.5 },
      { Produto: "B", Valor: 2000 },
    ]);
  });

  it("preserva hora do Excel sem convertê-la em 31/12/1899", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Hora"], [0.5]]);
    worksheet["A2"]!.z = "hh:mm";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Horários");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "horarios.xlsx");
    expect(sheet?.rows).toEqual([{ Hora: "12:00" }]);
  });

  it("preserva duração acima de 24 horas usando o formato exibido no Excel", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Duração"], [1.5]]);
    worksheet["A2"]!.z = "[h]:mm";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Durações");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "duracoes.xlsx");
    expect(sheet?.rows).toEqual([{ Duração: "36:00" }]);
  });

  it("preserva cabeçalhos de mês/ano sem inventar dia nem deslocar o mês pelo fuso", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Ponto / Item", new Date(2025, 5, 1), new Date(2025, 8, 1), new Date(2026, 2, 1)],
      ["Laboratório", 3, null, 4],
    ]);
    worksheet["B1"]!.z = "mmm-yy";
    worksheet["C1"]!.z = "mmm-yy";
    worksheet["D1"]!.z = "mmm-yy";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cronograma");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [sheet] = readWorkbookBytes(bytes, "cronograma.xlsx");

    expect(Object.keys(sheet?.rows[0] ?? {})).toEqual([
      "Ponto / Item",
      "jun/2025",
      "set/2025",
      "mar/2026",
    ]);
    expect(sheet?.rows[0]).toMatchObject({ "Ponto / Item": "Laboratório", "jun/2025": 3 });
  });

  it("não converte texto em data inválida quando a célula herdou o estilo de mês/ano", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Ponto / Item", new Date(2025, 5, 1), "Máx."],
      ["Laboratório", 3, 25],
    ]);
    worksheet["B1"]!.z = "mmm-yy";
    worksheet["C1"]!.z = "mmm-yy";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Cronograma");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [sheet] = readWorkbookBytes(bytes, "cronograma-com-maximo.xlsx");

    expect(Object.keys(sheet?.rows[0] ?? {})).toEqual(["Ponto / Item", "jun/2025", "Máx."]);
  });

  it.each(["xlsx", "xlsm", "xlsb", "xls", "ods", "fods"] as const)(
    "lê o formato %s",
    (bookType) => {
      const worksheet = XLSX.utils.aoa_to_sheet([
        ["Produto", "Valor"],
        ["Bolo", 42],
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
      const bytes = XLSX.write(workbook, { type: "array", bookType });
      const [sheet] = readWorkbookBytes(bytes, `vendas.${bookType}`);
      expect(sheet?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
    },
  );

  it.each(["xltx", "xltm"] as const)("aceita a extensão de modelo %s", (extension) => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, `modelo.${extension}`);
    expect(sheet?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
  });

  it("lê TSV sem confundir tabulação com conteúdo", () => {
    const [sheet] = readWorkbookBytes(
      new TextEncoder().encode("Produto\tValor\nBolo\t42"),
      "vendas.tsv",
    );
    expect(sheet?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
  });

  it("lê uma tabela HTML exportada como planilha", () => {
    const html =
      "<table><tr><th>Produto</th><th>Valor</th></tr><tr><td>Bolo</td><td>42</td></tr></table>";
    const [sheet] = readWorkbookBytes(new TextEncoder().encode(html), "vendas.html");
    expect(sheet?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
  });

  it("aceita um pacote XLSX normal na pré-verificação ZIP", () => {
    const bytes = zipSync({ "xl/workbook.xml": strToU8("<workbook />") });
    expect(() => validateZipWorkbook(bytes)).not.toThrow();
  });

  it("rejeita pacote ZIP truncado antes de tentar analisar a planilha", () => {
    expect(() => validateZipWorkbook(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).toThrow(
      "incompleto ou corrompido",
    );
  });

  it("preserva valor bruto, exibição e formato de células relevantes", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([["Taxa"], [0.125]]);
    worksheet["A2"]!.z = "0.0%";
    worksheet["A2"]!.w = "12.5%";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Indicadores");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const [sheet] = readWorkbookBytes(bytes, "indicadores.xlsx");
    expect(sheet?.rows[0]?.["Taxa"]).toBe(0.125);
    expect(sheet?.diagnostics?.sourceCellRepresentations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "A2",
          rawValue: 0.125,
          displayValue: "12.5%",
          numberFormat: "0.0%",
        }),
      ]),
    );
  });
});
