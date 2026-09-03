import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readOoxmlWorkbookProgressively } from "@/lib/ooxml-progressive-import";
import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";

/**
 * Medição dos dois caminhos de leitura de XLSX, sobre o mesmo arquivo, através
 * do coordenador inteiro (e não da grade isolada de `ooxml-sheet-grid.test.ts`).
 *
 * Roda fora da suíte normal, porque gera dezenas de MiB e leva dezenas de
 * segundos:
 *
 *     OLI_OOXML_BENCHMARK=1 NODE_OPTIONS=--expose-gc npx vitest run src/lib/ooxml-progressive-benchmark.test.ts
 *
 * Sem `--expose-gc` os tempos continuam válidos e as medidas de memória viram
 * ordem de grandeza. O relatório sai em `test-results/ooxml-progressive-benchmark.json`,
 * que o Git ignora.
 */

const ligado = process.env["OLI_OOXML_BENCHMARK"] === "1";
const podeColetar = typeof (globalThis as { gc?: () => void }).gc === "function";
const coletar = () => (globalThis as { gc?: () => void }).gc?.();

const LINHAS = 120_000;
const COLUNAS = ["Id", "Quando", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];
const SETORES = ["Compras", "Vendas", "Qualidade", "Logística", "Produção"];
const STATUS = ["Aprovado", "Reprovado", "Pendente"];

const MIB = 1024 * 1024;
const mib = (bytes: number) => Math.round((bytes / MIB) * 10) / 10;

function vivo(): number {
  coletar();
  const uso = process.memoryUsage();
  return uso.heapUsed + uso.external;
}

/** Fixture determinística com uma coluna de data de verdade, sem gerador externo. */
function construirFixture(): Uint8Array {
  const dados: unknown[][] = [COLUNAS];
  for (let linha = 0; linha < LINHAS; linha += 1)
    dados.push([
      linha,
      new Date(Date.UTC(2026, linha % 12, (linha % 28) + 1)),
      SETORES[linha % SETORES.length],
      `Produto ${linha % 400}`,
      linha % 97,
      (linha % 1000) + (linha % 100) / 100,
      STATUS[linha % STATUS.length],
      `Observação ${linha % 50}`,
    ]);
  const worksheet = XLSX.utils.aoa_to_sheet(dados);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", cellDates: true }));
}

type Medida = { picoBytes: number; ms: number; linhas: number };

/**
 * Mede no ponto mais largo de cada caminho: o instante em que a aba fica
 * pronta. No atual isso inclui o arquivo, o workbook do SheetJS, a inspeção
 * OOXML independente e a comparação entre os dois. No progressivo, só a grade
 * e as linhas.
 */
async function medirCaminhoAtual(bytes: Uint8Array): Promise<Medida> {
  const base = vivo();
  const inicio = Date.now();
  let pico = 0;
  let linhas = 0;
  await readWorkbookBytesWithEngine(bytes, "medicao.xlsx", undefined, {
    onSheet: (aba) => {
      linhas = aba.rows.length;
      pico = Math.max(pico, vivo() - base);
    },
  });
  return { picoBytes: pico, ms: Date.now() - inicio, linhas };
}

function medirCaminhoProgressivo(bytes: Uint8Array): Medida {
  const base = vivo();
  const inicio = Date.now();
  let pico = 0;
  let linhas = 0;
  readOoxmlWorkbookProgressively(bytes, {
    fileName: "medicao.xlsx",
    onSheet: (aba) => {
      linhas = aba.rows.length;
      pico = Math.max(pico, vivo() - base);
    },
  });
  return { picoBytes: pico, ms: Date.now() - inicio, linhas };
}

describe.skipIf(!ligado)("medição do coordenador progressivo de OOXML", () => {
  it(
    "compara pico e tempo contra o caminho atual, pelo coordenador inteiro",
    { timeout: 600_000 },
    async () => {
      const bytes = construirFixture();
      const atual = await medirCaminhoAtual(bytes);
      const progressivo = medirCaminhoProgressivo(bytes);
      const celulas = atual.linhas * COLUNAS.length;

      const relatorio = {
        geradoEm: new Date().toISOString(),
        node: process.version,
        medicaoDeMemoriaConfiavel: podeColetar,
        fixture: {
          linhas: LINHAS,
          colunas: COLUNAS.length,
          arquivoMiB: mib(bytes.length),
          celulasNormalizadas: celulas,
        },
        caminhoAtual: { picoMiB: mib(atual.picoBytes), ms: atual.ms, linhas: atual.linhas },
        caminhoProgressivo: {
          picoMiB: mib(progressivo.picoBytes),
          ms: progressivo.ms,
          linhas: progressivo.linhas,
        },
        reducaoDePico: `${Math.round((1 - progressivo.picoBytes / atual.picoBytes) * 100)}%`,
        bytesPorCelulaNoProgressivo:
          Math.round((progressivo.picoBytes / Math.max(1, celulas)) * 10) / 10,
      };

      fs.mkdirSync("test-results", { recursive: true });
      fs.writeFileSync(
        path.join("test-results", "ooxml-progressive-benchmark.json"),
        `${JSON.stringify(relatorio, null, 2)}\n`,
      );
      process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);

      expect(progressivo.linhas).toBe(atual.linhas);
      if (podeColetar) expect(progressivo.picoBytes).toBeLessThan(atual.picoBytes);
    },
  );
});
