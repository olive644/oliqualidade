import { describe, expect, it, vi } from "vitest";
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
import * as ooxmlArchive from "@/lib/ooxml-archive";
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

    const progress: string[] = [];
    const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", (phase) =>
      progress.push(phase),
    );

    expect(result.sheets[0]?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
    expect(result.report).toMatchObject({
      reader: "sheetjs-verified",
      format: "xlsx",
      sheets: 1,
      fallbackUsed: false,
    });
    expect(result.report.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.report.analysisMs).toBeGreaterThanOrEqual(0);
    expect(result.report.visitedCells).toBe(4);
    expect(result.report.estimatedPeakMemoryBytes).toBeGreaterThan(result.report.expandedBytes);
    expect(progress).toEqual(["decoding", "parsing", "verifying", "analyzing", "complete"]);
  });

  it("descompacta o pacote OOXML uma única vez, compartilhada entre metadados e verificação independente", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;

    const spy = vi.spyOn(ooxmlArchive, "unzipOoxmlArchive");
    try {
      const asyncResult = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx");
      expect(asyncResult.report.reader).toBe("sheetjs-verified");
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockClear();
      const syncSheets = readWorkbookBytes(bytes, "vendas.xlsx");
      expect(syncSheets[0]?.rows).toEqual([{ Produto: "Bolo", Valor: 42 }]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("registra bytes de origem e bytes descompactados no relatório", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx");
    const zipInfo = validateZipWorkbook(new Uint8Array(bytes));

    expect(result.report.sourceBytes).toBe(bytes.byteLength);
    // Soma exata declarada no diretório central do ZIP (mesmo valor que
    // `validateZipWorkbook` calcula para os limites de segurança) — não
    // necessariamente maior que o arquivo compactado inteiro, já que o
    // contêiner ZIP tem overhead estrutural por entrada (cabeçalhos locais,
    // diretório central) que não entra nessa soma.
    expect(result.report.expandedBytes).toBe(zipInfo.totalUncompressedBytes);
    expect(result.report.expandedBytes).toBeGreaterThan(0);
  });

  it("iguala bytes de origem e descompactados para formatos sem compressão (CSV)", async () => {
    const csv = "Produto,Valor\nBolo,42\n";
    const bytes = strToU8(csv);

    const result = await readWorkbookBytesWithEngine(bytes, "vendas.csv");

    expect(result.report.sourceBytes).toBe(bytes.length);
    expect(result.report.expandedBytes).toBe(bytes.length);
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
      const result = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "shadow",
      });
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
        reader: "rust-wasm",
        wasmReaderMode: "candidate",
        wasmCandidateStatus: "primary",
        wasmFallbackReason: null,
        wasmOutputUsed: true,
        wasmSampleRate: 1,
        wasmShadowStatus: "matched",
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("materializa metadados OOXML no candidato Rust sem copiá-los do workbook validado", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Produto", "Valor"],
      ["Bolo", 42],
    ]);
    worksheet["!autofilter"] = { ref: "A1:B2" };
    worksheet["A2"]!.c = [{ a: "Qualidade", t: "Conferir cadastro" }];
    worksheet["B2"]!.l = { Target: "https://example.com/item/42", Tooltip: "Abrir item" };
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
      });
      expect(result.report).toMatchObject({
        reader: "rust-wasm",
        wasmCandidateStatus: "primary",
        wasmFallbackReason: null,
        wasmOutputUsed: true,
      });
      expect(result.sheets[0]?.diagnostics).toMatchObject({
        hasAutoFilter: true,
        autofilterRange: "A1:B2",
        sourceNotes: [
          {
            address: "A2",
            author: "Qualidade",
            kind: "comment",
            text: "Conferir cadastro",
          },
        ],
      });
    } finally {
      registerWasmWorkbookReader(undefined);
    }
  });

  it("rollback: VITE_WASM_READER_MODE=shadow desativa o candidato Rust mesmo quando ele seria promovido", async () => {
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
      // Mesmo arquivo, mesmo adaptador Rust registrado, dados idênticos: em modo
      // candidato (padrão de produção) o resultado é promovido a "rust-wasm".
      const candidateResult = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "candidate",
        wasmCandidateFormats: ["xlsx"],
      });
      expect(candidateResult.report).toMatchObject({
        reader: "rust-wasm",
        wasmCandidateStatus: "primary",
        wasmOutputUsed: true,
      });

      // Único parâmetro alterado: wasmReaderMode "shadow", equivalente a mudar
      // apenas a variável de ambiente VITE_WASM_READER_MODE, sem tocar em código.
      // A allowlist de formatos permanece igual e o adaptador Rust continua
      // registrado e disponível — o rollback precisa ser suficiente sozinho.
      const shadowResult = await readWorkbookBytesWithEngine(bytes, "vendas.xlsx", undefined, {
        wasmReaderMode: "shadow",
        wasmCandidateFormats: ["xlsx"],
      });
      expect(shadowResult.sheets[0]?.rows).toEqual(candidateResult.sheets[0]?.rows);
      expect(shadowResult.report).toMatchObject({
        reader: "sheetjs-verified",
        wasmReaderMode: "shadow",
        wasmCandidateStatus: "shadow",
        wasmFallbackReason: null,
        wasmOutputUsed: false,
        // O adaptador continua disponível e é medido silenciosamente: o
        // rollback desativa a promoção, não a observabilidade.
        wasmAvailable: true,
        wasmShadowStatus: "matched",
      });
      expect(shadowResult.report.wasmComparedCells).toBeGreaterThan(0);
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

  it("recua quando a materialização Rust altera a saída final da importação", async () => {
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
          actualDimension: {
            start: "A1",
            end: "Z1000",
            rows: 1000,
            columns: 26,
            cellCount: cells.size,
          },
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
        wasmFallbackReason: "output-diverged",
        wasmOutputUsed: false,
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
        wasmReaderMode: "shadow",
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
  it("lê com sucesso uma planilha grande (bem abaixo do limite de rejeição)", () => {
    // O teste acima só cobre o caminho de rejeição (dimensão abusiva
    // declarada). Este cobre o caminho positivo: um volume real, mas
    // seguro, precisa continuar íntegro linha a linha, sem truncar nem
    // embaralhar.
    const rowCount = 5_000;
    const rows: (string | number)[][] = [["Id", "Nome", "Valor"]];
    for (let i = 1; i <= rowCount; i++) rows.push([i, `Item ${i}`, i * 1.5]);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [sheet] = readWorkbookBytes(bytes, "grande.xlsx");
    expect(sheet?.rows).toHaveLength(rowCount);
    expect(sheet?.rows[0]).toEqual({ Id: 1, Nome: "Item 1", Valor: 1.5 });
    expect(sheet?.rows[rowCount - 1]).toEqual({
      Id: rowCount,
      Nome: `Item ${rowCount}`,
      Valor: rowCount * 1.5,
    });
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

  it("remove o BOM UTF-8 do CSV sem deixá-lo grudado no nome da primeira coluna", () => {
    // Excel e outras ferramentas gravam um BOM (U+FEFF) no início do CSV
    // UTF-8 para sinalizar a codificação. Sem removê-lo, o nome da primeira
    // coluna fica com o BOM grudado no início — quebra silenciosamente
    // qualquer lookup por nome de coluna feito no restante do sistema.
    const source = "\uFEFFProduto;Valor\nBolo;42";
    const bytes = new TextEncoder().encode(source);
    const [sheet] = readWorkbookBytes(bytes, "vendas.csv");
    expect(Object.keys(sheet?.rows[0] ?? {})).toEqual(["Produto", "Valor"]);
    expect(sheet?.rows[0]).toEqual({ Produto: "Bolo", Valor: 42 });
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

    expect(Object.keys(sheet?.rows[0] ?? {})).toEqual(["Ponto / Item", "jun/2025", "mar/2026"]);
    expect(sheet?.rows[0]).toMatchObject({ "Ponto / Item": "Laboratório", "jun/2025": 3 });
    expect(sheet?.rows[0]).not.toHaveProperty("set/2025");
  });

  it("preserva o dia de uma coluna de datas exibida como mm/yy", () => {
    // Reproduz o FRS-QA-BR-413: a coluna "DATA" tem uma data real e distinta
    // por linha, mas o Excel a exibe compacta como "03/11". Colapsar para
    // mês/ano (tratamento correto de `mmm-yy`, que é rótulo de período)
    // fazia todas as linhas virarem a mesma data, escondendo a diferença.
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["EQUIPAMENTO", "DATA"],
      ["Balança", new Date(2011, 2, 1)],
      ["Termômetro", new Date(2011, 2, 2)],
      ["Manômetro", new Date(2011, 2, 3)],
    ]);
    for (const address of ["B2", "B3", "B4"]) worksheet[address]!.z = "mm/yy";
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plan1");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [sheet] = readWorkbookBytes(bytes, "calibracao.xlsx");

    expect(sheet?.rows.map((row) => row["DATA"])).toEqual([
      "01/03/2011",
      "02/03/2011",
      "03/03/2011",
    ]);
    expect(Object.keys(sheet?.rows[0] ?? {})).toEqual(["EQUIPAMENTO", "DATA"]);
  });

  it("não promove o primeiro registro a cabeçalho quando ele tem mais colunas preenchidas", () => {
    // Também do FRS-QA-BR-413: o cabeçalho real deixa a última coluna sem
    // rótulo, então a primeira linha de dados o supera em preenchimento. As
    // datas soltas entre campos de texto são o que revela que ela é dado.
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["EQUIPAMENTO", "MODELO", "SETOR", "CÓDIGO", "DATA", null],
      ["Balança", "MIC-15", "Preparação", "BA01", new Date(2011, 2, 1), new Date(2011, 8, 1)],
      ["Balança", "BP15", "Sorvete", "BA02", new Date(2011, 2, 2), new Date(2011, 8, 2)],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plan1");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const [sheet] = readWorkbookBytes(bytes, "cronograma-calibracao.xlsx");

    expect(Object.keys(sheet?.rows[0] ?? {}).slice(0, 5)).toEqual([
      "EQUIPAMENTO",
      "MODELO",
      "SETOR",
      "CÓDIGO",
      "DATA",
    ]);
    expect(sheet?.rows).toHaveLength(2);
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

  it("rejeita um ZIP que declara arquivos internos demais, sem ler o diretório", () => {
    // A checagem só lê o registro EOCD (fim do diretório central) e o
    // total de entradas declarado; nem precisa de um diretório real para
    // recusar, então um arquivo hostil que só mente sobre a contagem já é
    // barrado antes de qualquer tentativa de percorrê-lo.
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, 0x06054b50, true); // assinatura EOCD
    view.setUint16(10, 10_001, true); // total de entradas > MAX_ZIP_ENTRIES
    expect(() => validateZipWorkbook(eocd)).toThrow("arquivos internos demais");
  });

  it("rejeita uma entrada com razão de compressão suspeita (zip bomb)", () => {
    // Uma entrada de diretório central que declara 100 MB descompactados a
    // partir de 100 bytes compactados (razão ~1 milhão) é o padrão clássico
    // de zip bomb: nunca precisa ser descompactada de verdade para ser
    // recusada, pois a checagem só lê os tamanhos declarados no cabeçalho.
    const centralDirectory = new Uint8Array(46); // sem nome/extra/comentário
    const directoryView = new DataView(centralDirectory.buffer);
    directoryView.setUint32(0, 0x02014b50, true); // assinatura de entrada
    directoryView.setUint32(20, 100, true); // compactado: 100 bytes
    directoryView.setUint32(24, 100 * 1024 * 1024, true); // descompactado: 100 MB

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(10, 1, true); // 1 entrada
    eocdView.setUint32(12, centralDirectory.length, true); // tamanho do diretório
    eocdView.setUint32(16, 0, true); // diretório começa no início do buffer

    const bytes = new Uint8Array(centralDirectory.length + eocd.length);
    bytes.set(centralDirectory, 0);
    bytes.set(eocd, centralDirectory.length);

    expect(() => validateZipWorkbook(bytes)).toThrow("taxa de compressão potencialmente insegura");
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
