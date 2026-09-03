import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  readOoxmlWorkbookProgressively,
  estimateProgressiveOoxmlPeakMemoryBytes,
} from "@/lib/ooxml-progressive-import";
import { ProgressiveImportFallback } from "@/lib/workbook-reading-engine";
import { describeImportedSheetsDifferences } from "@/lib/progressive-import";
import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";

/**
 * O caminho progressivo de OOXML precisa devolver o mesmo `WorkbookReadResult`
 * do caminho atual, pela mesma vara de medir usada em `ooxml-sheet-grid.test.ts`:
 * quantas abas coincidem nome a nome e linha a linha. Este arquivo testa o
 * coordenador inteiro (validação, leitura, anexação de recursos e relatório),
 * e não só a grade — é a ligação que fica testada aqui, não a peça isolada.
 */

async function abasPeloCaminhoAtual(bytes: Uint8Array, fileName = "planilha.xlsx") {
  return (await readWorkbookBytesWithEngine(bytes, fileName)).sheets;
}

function abasPeloCaminhoProgressivo(bytes: Uint8Array, fileName = "planilha.xlsx") {
  return readOoxmlWorkbookProgressively(bytes, { fileName }).sheets;
}

function pacoteDe(dados: unknown[][]): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet(dados);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

describe("o coordenador progressivo de OOXML normaliza igual ao caminho atual", () => {
  it("números, textos e vazios", async () => {
    const bytes = pacoteDe([
      ["Nome", "Quantidade", "Observação"],
      ["Ana", 10, "primeira"],
      ["Bruno", null, null],
      ["Carla", 0, "zero"],
    ]);

    const atual = await abasPeloCaminhoAtual(bytes);
    const progressivo = abasPeloCaminhoProgressivo(bytes);

    expect(describeImportedSheetsDifferences(atual, progressivo)).toEqual([]);
  });

  it("data com formato, booleano e mesclagem", async () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Título", null],
      ["Quando", "Ativo"],
      [new Date(Date.UTC(2026, 7, 27)), true],
      [new Date(Date.UTC(2026, 7, 28)), false],
    ]);
    worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
    const bytes = new Uint8Array(
      XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }),
    );

    const atual = await abasPeloCaminhoAtual(bytes);
    const progressivo = abasPeloCaminhoProgressivo(bytes);

    expect(describeImportedSheetsDifferences(atual, progressivo)).toEqual([]);
  });

  it("relatório identifica o leitor e não roda verificação cruzada", () => {
    const bytes = pacoteDe([
      ["Nome", "Valor"],
      ["Ana", 1],
    ]);

    const { report } = readOoxmlWorkbookProgressively(bytes, { fileName: "planilha.xlsx" });

    expect(report.reader).toBe("ooxml-progressivo");
    expect(report.verificationMs).toBe(0);
    expect(report.repairedCells).toBe(0);
    expect(report.divergentCells).toBe(0);
    expect(report.fallbackUsed).toBe(false);
    expect(report.sheets).toBe(1);
    expect(report.estimatedPeakMemoryBytes).toBe(
      estimateProgressiveOoxmlPeakMemoryBytes({ cells: report.visitedCells }),
    );
  });

  it("escoa abas por `onSheet` sem retê-las no resultado", () => {
    const bytes = pacoteDe([
      ["Nome", "Valor"],
      ["Ana", 1],
    ]);

    const recebidas: string[] = [];
    const { sheets } = readOoxmlWorkbookProgressively(bytes, {
      fileName: "planilha.xlsx",
      onSheet: (sheet) => recebidas.push(sheet.name),
    });

    expect(recebidas).toEqual(["Dados"]);
    expect(sheets).toEqual([]);
  });
});

describe("recusa contra indisponibilidade, e não contra falha do arquivo", () => {
  it("um CSV renomeado para .xlsx cai no caminho atual, sem erro", () => {
    const bytes = new TextEncoder().encode("a,b,c\n1,2,3\n");

    expect(() => readOoxmlWorkbookProgressively(bytes, { fileName: "planilha.xlsx" })).toThrow(
      ProgressiveImportFallback,
    );
  });

  it("um pacote ZIP que não é um workbook OOXML também recusa, e não falha", () => {
    // Um ZIP válido, mas sem `xl/workbook.xml`: o leitor de grade não encontra o
    // que precisa e deve devolver indisponibilidade, não um erro que a pessoa vê.
    const zipVazio = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    expect(() => readOoxmlWorkbookProgressively(zipVazio, { fileName: "planilha.xlsx" })).toThrow(
      ProgressiveImportFallback,
    );
  });

  it("um arquivo com assinatura irreconhecível é um erro de verdade", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    expect(() => readOoxmlWorkbookProgressively(bytes, { fileName: "planilha.xlsx" })).toThrow(
      /não foi possível reconhecer|não reconhecido|Formato/i,
    );
  });

  it("uma aba dividida em seções recusa o arquivo inteiro, mesmo sem falha no leitor", () => {
    // Mesmos dados de import.test.ts ("separa quadros empilhados que se
    // encostam..."): dois quadros com título explícito terminado em ":", sem
    // linha vazia entre eles. `detectIndependentSections` os divide em duas
    // abas nomeadas com o separador " · ", e é esse nome que o coordenador usa
    // para recusar — sem um segundo motor para comparar, não dá para saber
    // aqui se o caminho atual dividiria do mesmo jeito.
    const bytes = pacoteDe([
      ["Bebidas:"],
      ["Produto", "Quantidade", "Análise"],
      ["Suco", 1, "Bolores"],
      ["Refrigerante", 2, "Leveduras"],
      ["Água Potável:"],
      ["Material", "Frequência", "Análise"],
      ["Água", "Diário", "Cloro"],
      ["Água", "Mensal", "Coliformes"],
    ]);

    expect(() => readOoxmlWorkbookProgressively(bytes, { fileName: "planilha.xlsx" })).toThrow(
      ProgressiveImportFallback,
    );
  });
});

/**
 * A mesma comparação por aba de `ooxml-sheet-grid.test.ts`, agora passando pelo
 * coordenador inteiro em vez da grade isolada. O corpus é local e não
 * versionado, então este bloco é pulado na CI.
 */
const RAIZES = ["test-fixtures/sanitized-real", "upload"];

function planilhasLocais(): string[] {
  const encontrados: string[] = [];
  for (const raiz of RAIZES) {
    if (!existsSync(raiz)) continue;
    for (const nome of readdirSync(raiz).sort())
      if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(nome)) encontrados.push(join(raiz, nome));
  }
  return encontrados;
}

const locais = planilhasLocais();

describe.skipIf(!locais.length)("o coordenador contra o caminho atual, em planilhas reais", () => {
  it(
    "recusa arquivo com divisão em seções, e o resto bate com o caminho atual",
    { timeout: 300_000 },
    async () => {
      let abasAtuais = 0;
      let abasIguais = 0;
      let arquivosRecusados = 0;
      for (const caminho of locais) {
        const bytes = new Uint8Array(readFileSync(caminho));
        let atual;
        let progressivo;
        try {
          atual = await abasPeloCaminhoAtual(bytes, caminho);
        } catch {
          continue;
        }
        try {
          progressivo = abasPeloCaminhoProgressivo(bytes, caminho);
        } catch (erro) {
          if (erro instanceof ProgressiveImportFallback) {
            arquivosRecusados += 1;
            continue;
          }
          throw erro;
        }
        abasAtuais += atual.length;
        const porNome = new Map(progressivo.map((aba) => [aba.name, aba]));
        for (const aba of atual) {
          const nova = porNome.get(aba.name);
          if (nova && describeImportedSheetsDifferences([aba], [nova], 1).length === 0)
            abasIguais += 1;
        }
      }

      process.stdout.write(
        `\n  ${abasAtuais} abas pelo caminho atual (fora dos arquivos recusados), ` +
          `${abasIguais} idênticas pelo coordenador, ${arquivosRecusados} arquivo(s) recusado(s)\n`,
      );
      // O piso caiu de 87 (medido antes da recusa contra divisão em seções
      // existir) para 79: o único arquivo do corpus com uma aba dividida em
      // seções (FRS-QA-BR-405) passou a ser recusado inteiro, e ele também
      // contribuía abas que batiam (fora das divididas). Excluir o arquivo
      // inteiro em vez de aba a aba é a escolha mais simples e mais segura —
      // ver o comentário no topo de `ooxml-progressive-import.ts`.
      expect(arquivosRecusados).toBeGreaterThanOrEqual(1);
      expect(abasIguais).toBeGreaterThanOrEqual(79);
    },
  );
});
