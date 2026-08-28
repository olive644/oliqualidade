import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCsvWorkbookProgressively } from "@/lib/csv-progressive-import";
import { PROGRESSIVE_BLOCK_SIZE_CANDIDATES } from "@/lib/progressive-import";
import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";

/**
 * Medição dos dois caminhos de leitura de CSV, sobre o mesmo arquivo.
 *
 * Roda fora da suíte normal, porque gera dezenas de MiB e leva dezenas de
 * segundos. É deste arquivo que saem os números publicados sobre a leitura
 * progressiva, e por isso ele mede o **código que é entregue**, e não uma
 * réplica dele montada para o benchmark:
 *
 *     OLI_CSV_BENCHMARK=1 NODE_OPTIONS=--expose-gc npx vitest run src/lib/csv-progressive-benchmark.test.ts
 *
 * Sem `--expose-gc` os tempos continuam válidos e as medidas de memória viram
 * ordem de grandeza, exatamente como em `scripts/benchmark-import-baseline.mjs`.
 * O relatório sai em `test-results/csv-progressive-benchmark.json`, que o Git
 * ignora. A fixture é sintética, determinística e apagada no fim.
 */

const ligado = process.env["OLI_CSV_BENCHMARK"] === "1";
const podeColetar = typeof (globalThis as { gc?: () => void }).gc === "function";
const coletar = () => (globalThis as { gc?: () => void }).gc?.();

const LINHAS = 120_000;
const COLUNAS = ["Id", "Data", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];
const SETORES = ["Compras", "Vendas", "Qualidade", "Logística", "Produção"];
const STATUS = ["Aprovado", "Reprovado", "Pendente"];

const MIB = 1024 * 1024;
const mib = (bytes: number) => Math.round((bytes / MIB) * 10) / 10;

/**
 * Memória viva agora, somando heap e memória externa.
 *
 * A soma importa: um `Uint8Array` grande vive fora do heap do V8, e medir só
 * `heapUsed` mostraria o arquivo em memória como zero, que é justamente uma das
 * cópias sob investigação.
 */
function vivo(): number {
  coletar();
  const uso = process.memoryUsage();
  return uso.heapUsed + uso.external;
}

/** CSV determinístico, escrito direto no disco para nunca existir inteiro na memória. */
function escreverFixture(destino: string): number {
  const fluxo = fs.openSync(destino, "w");
  try {
    fs.writeSync(fluxo, `${COLUNAS.join(";")}\n`);
    let lote = "";
    for (let linha = 0; linha < LINHAS; linha += 1) {
      const dia = (linha % 28) + 1;
      lote +=
        `${linha};` +
        `${String(dia).padStart(2, "0")}/0${(linha % 9) + 1}/2026;` +
        `${SETORES[linha % SETORES.length]};` +
        `Produto ${linha % 400};` +
        `${linha % 97};` +
        `${(linha % 1000) + (linha % 100) / 100};` +
        `${STATUS[linha % STATUS.length]};` +
        `Observação ${linha % 50}\n`;
      if (lote.length > 1 << 20) {
        fs.writeSync(fluxo, lote);
        lote = "";
      }
    }
    if (lote) fs.writeSync(fluxo, lote);
  } finally {
    fs.closeSync(fluxo);
  }
  return fs.statSync(destino).size;
}

type Medida = { picoBytes: number; ms: number; linhas: number };

/**
 * Mede no ponto mais largo de cada caminho: o instante em que a aba fica pronta.
 *
 * É ali que tudo o que o caminho precisou coexiste. No atual: o arquivo em
 * memória, o workbook do SheetJS e as linhas normalizadas. No progressivo: a
 * grade e as linhas, sem arquivo e sem worksheet. Medir nesse instante, nos
 * dois, é o que torna a comparação honesta; medir no fim mediria só o que
 * sobrou, que é a mesma coisa nos dois lados.
 */
async function medirCaminhoAtual(arquivo: string): Promise<Medida> {
  const base = vivo();
  const inicio = Date.now();
  const bytes = await fs.promises.readFile(arquivo);
  let pico = 0;
  let linhas = 0;
  await readWorkbookBytesWithEngine(bytes.buffer as ArrayBuffer, "medicao.csv", undefined, {
    onSheet: (aba) => {
      linhas = aba.rows.length;
      pico = Math.max(pico, vivo() - base);
    },
  });
  return { picoBytes: pico, ms: Date.now() - inicio, linhas };
}

async function medirCaminhoProgressivo(arquivo: string, blockSize: number): Promise<Medida> {
  const base = vivo();
  const inicio = Date.now();
  const blob = await fs.openAsBlob(arquivo);
  let pico = 0;
  let linhas = 0;
  await readCsvWorkbookProgressively(blob, {
    fileName: "medicao.csv",
    blockSize,
    onSheet: (aba) => {
      linhas = aba.rows.length;
      pico = Math.max(pico, vivo() - base);
    },
  });
  return { picoBytes: pico, ms: Date.now() - inicio, linhas };
}

describe.skipIf(!ligado)("medição do caminho progressivo de CSV", () => {
  it(
    "compara pico e tempo contra o caminho atual, e escolhe o tamanho de bloco",
    { timeout: 600_000 },
    async () => {
      const arquivo = path.join(os.tmpdir(), `oli-csv-benchmark-${process.pid}.csv`);
      const arquivoBytes = escreverFixture(arquivo);
      try {
        const atual = await medirCaminhoAtual(arquivo);
        const porBloco: Record<number, Medida> = {};
        for (const candidato of PROGRESSIVE_BLOCK_SIZE_CANDIDATES)
          porBloco[candidato] = await medirCaminhoProgressivo(arquivo, candidato);

        const melhor = PROGRESSIVE_BLOCK_SIZE_CANDIDATES.reduce((a, b) =>
          porBloco[a]!.picoBytes <= porBloco[b]!.picoBytes ? a : b,
        );
        const progressivo = porBloco[melhor]!;
        const celulas = atual.linhas * COLUNAS.length;

        const relatorio = {
          geradoEm: new Date().toISOString(),
          node: process.version,
          medicaoDeMemoriaConfiavel: podeColetar,
          fixture: {
            linhas: LINHAS,
            colunas: COLUNAS.length,
            arquivoMiB: mib(arquivoBytes),
            celulasNormalizadas: celulas,
          },
          caminhoAtual: { picoMiB: mib(atual.picoBytes), ms: atual.ms, linhas: atual.linhas },
          caminhoProgressivo: Object.fromEntries(
            PROGRESSIVE_BLOCK_SIZE_CANDIDATES.map((candidato) => [
              candidato,
              {
                picoMiB: mib(porBloco[candidato]!.picoBytes),
                ms: porBloco[candidato]!.ms,
                linhas: porBloco[candidato]!.linhas,
              },
            ]),
          ),
          blocoDeMenorPico: melhor,
          reducaoDePico: `${Math.round((1 - progressivo.picoBytes / atual.picoBytes) * 100)}%`,
          bytesPorCelulaNoProgressivo:
            Math.round((progressivo.picoBytes / Math.max(1, celulas)) * 10) / 10,
        };

        fs.mkdirSync("test-results", { recursive: true });
        fs.writeFileSync(
          path.join("test-results", "csv-progressive-benchmark.json"),
          `${JSON.stringify(relatorio, null, 2)}\n`,
        );
        process.stdout.write(`${JSON.stringify(relatorio, null, 2)}\n`);

        // Os dois caminhos precisam ler a mesma planilha: comparar picos de
        // resultados diferentes não compararia nada.
        for (const candidato of PROGRESSIVE_BLOCK_SIZE_CANDIDATES)
          expect(porBloco[candidato]!.linhas).toBe(atual.linhas);
        if (podeColetar) expect(progressivo.picoBytes).toBeLessThan(atual.picoBytes);
      } finally {
        fs.rmSync(arquivo, { force: true });
      }
    },
  );
});
