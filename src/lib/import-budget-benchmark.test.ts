import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { compareAndRepairWithOoxml, inspectOoxml } from "@/lib/ooxml-reader";
import { WORKBOOK_READ_TIMEOUT_MS } from "@/lib/workbook-reader-client";
import { readWorkbookBytesWithEngine } from "@/lib/workbook-reader";

/**
 * Onde vai o orçamento de 60 segundos da leitura.
 *
 * O número que circula no projeto vem da seção 145 do audit: um XLSX de 61 MiB
 * com 12 abas e 1,44 milhão de células consumiu 30s, metade do prazo, numa
 * máquina de desenvolvimento. Era uma medição avulsa, feita uma vez, antes de
 * várias mudanças no caminho de leitura, e desde então ela vinha sendo citada
 * como se ainda valesse.
 *
 * Este arquivo a torna reproduzível. Ele mede as fases que o próprio leitor já
 * reporta, sobre uma fixture da mesma forma, e diz quanto sobra do prazo:
 *
 *     OLI_BUDGET_BENCHMARK=1 npx vitest run src/lib/import-budget-benchmark.test.ts
 *
 * Fica desligado por padrão porque gera dezenas de MiB e leva perto de um
 * minuto. A fixture é sintética, determinística e não é versionada.
 */

const ligado = process.env["OLI_BUDGET_BENCHMARK"] === "1";

const COLUNAS = ["Id", "Data", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];

/**
 * Um pacote da mesma forma que o da seção 145: 12 abas, 1,44 milhão de células.
 *
 * O tamanho não é escolha livre. `XLSX.write` falha com `RangeError` acima de
 * cerca de 4 milhões de células, porque monta o ZIP inteiro como uma string só,
 * e é por isso que a fixture para aqui em vez de ir até o teto do produto, que
 * é de 2 milhões de células mas com folga de arquivo bem maior.
 */
function pacoteDoOrcamento(): { bytes: Uint8Array; abas: number; celulas: number } {
  const abas = 12;
  const linhasPorAba = 15_000;
  const workbook = XLSX.utils.book_new();
  for (let aba = 0; aba < abas; aba += 1) {
    const dados: (string | number)[][] = [COLUNAS];
    for (let linha = 0; linha < linhasPorAba; linha += 1)
      dados.push([
        linha,
        `${String((linha % 28) + 1).padStart(2, "0")}/0${(linha % 9) + 1}/2026`,
        `Setor ${linha % 5}`,
        `Produto ${linha % 400}`,
        linha % 97,
        (linha % 1000) + (linha % 100) / 100,
        `Status ${linha % 3}`,
        `Observação ${linha % 50}`,
      ]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(dados), `Aba ${aba + 1}`);
  }
  return {
    bytes: new Uint8Array(
      XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }),
    ),
    abas,
    celulas: abas * (linhasPorAba + 1) * COLUNAS.length,
  };
}

const QUEBRA = "\n";
const mib = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
const pct = (parte: number, todo: number) => `${Math.round((parte / Math.max(1, todo)) * 100)}%`;

describe.skipIf(!ligado)("orçamento de 60s da leitura", () => {
  it("diz quanto do prazo cada fase consome, e quanto sobra", { timeout: 900_000 }, async () => {
    const fixture = pacoteDoOrcamento();
    const { report } = await readWorkbookBytesWithEngine(
      fixture.bytes.buffer as ArrayBuffer,
      "orcamento.xlsx",
    );

    // O relatório do leitor já mede as fases: aqui elas só são somadas e
    // postas contra o prazo, em vez de medidas de novo por fora.
    const medido = report.parseMs + report.verificationMs + report.analysisMs;
    const outros = report.elapsedMs - medido;

    process.stdout.write(
      [
        "",
        `  arquivo: ${mib(fixture.bytes.byteLength)} MiB, ${fixture.abas} abas, ${fixture.celulas.toLocaleString("pt-BR")} células`,
        `  parse (opaco):   ${String(report.parseMs).padStart(6)} ms  ${pct(report.parseMs, report.elapsedMs)}`,
        `  verificação:     ${String(report.verificationMs).padStart(6)} ms  ${pct(report.verificationMs, report.elapsedMs)}`,
        `  análise:         ${String(report.analysisMs).padStart(6)} ms  ${pct(report.analysisMs, report.elapsedMs)}`,
        `  resto:           ${String(outros).padStart(6)} ms  ${pct(outros, report.elapsedMs)}`,
        `  total:           ${String(report.elapsedMs).padStart(6)} ms  de ${WORKBOOK_READ_TIMEOUT_MS} ms de prazo`,
        `  folga:           ${pct(WORKBOOK_READ_TIMEOUT_MS - report.elapsedMs, WORKBOOK_READ_TIMEOUT_MS)} do prazo`,
        "",
      ].join("\n"),
    );

    const antesDaLeitura = Date.now();
    const inspecao = inspectOoxml(fixture.bytes);
    const leituraIndependenteMs = Date.now() - antesDaLeitura;

    const primario = XLSX.read(fixture.bytes, {
      type: "array",
      cellDates: true,
      cellNF: true,
      cellText: true,
      dense: true,
    });
    const antesDaComparacao = Date.now();
    compareAndRepairWithOoxml(primario, inspecao);
    const comparacaoMs = Date.now() - antesDaComparacao;

    process.stdout.write(
      [
        `  dentro da verificação:`,
        `    leitura independente do XML: ${String(leituraIndependenteMs).padStart(6)} ms  ${pct(leituraIndependenteMs, report.verificationMs)} dela`,
        `    comparação e reparo:         ${String(comparacaoMs).padStart(6)} ms  ${pct(comparacaoMs, report.verificationMs)} dela`,
        "",
      ].join(QUEBRA),
    );

    // As fases medidas precisam explicar a maior parte do tempo, senão o que
    // este benchmark mostra não é o que a leitura faz.
    expect(medido).toBeGreaterThan(report.elapsedMs * 0.5);
    expect(inspecao.sheets.size).toBe(fixture.abas);
    // E o arquivo precisa caber no prazo nesta máquina. Se um dia não couber,
    // a importação passa a ser recusada por tempo e não por tamanho, e é
    // melhor descobrir aqui do que na tela de alguém.
    expect(report.elapsedMs).toBeLessThan(WORKBOOK_READ_TIMEOUT_MS);
  });
});
