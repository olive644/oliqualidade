/**
 * Baseline da importação: onde o tempo e a memória realmente vão.
 *
 * Existe para responder, com número e não com palpite, as perguntas que
 * decidem a arquitetura de leitura progressiva: quantas cópias grandes do mesmo
 * conteúdo existem ao mesmo tempo, qual delas domina o pico, e a partir de que
 * tamanho o caminho atual deixa de ser confortável.
 *
 * Roda em Node, fora do navegador, de propósito: o que se mede aqui são as
 * cópias do lado do leitor (arquivo, ZIP expandido, workbook, inventário
 * independente, abas normalizadas), que são as mesmas nos dois ambientes. O que
 * o navegador acrescenta por cima (clone estrutural para a aba, retenção
 * posterior) está anotado no relatório como não medido aqui.
 *
 * As medidas de memória usam `--expose-gc`. Sem essa flag os números saem
 * inflados por lixo ainda não coletado, então o script avisa em vez de fingir
 * precisão:
 *
 *     node --expose-gc scripts/benchmark-import-baseline.mjs
 *     node --expose-gc scripts/benchmark-import-baseline.mjs --quick
 *
 * As fixtures são sintéticas e determinísticas, geradas na hora. Nenhum arquivo
 * grande é versionado, e nenhum dado real do usuário entra aqui.
 */

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";

const quick = process.argv.includes("--quick");
const podeColetar = typeof global.gc === "function";

if (!podeColetar) {
  console.warn(
    "Aviso: rodando sem --expose-gc. Os tempos continuam válidos, mas as medidas de memória\n" +
      "incluem lixo não coletado e servem só como ordem de grandeza.\n",
  );
}

/**
 * Cenários. Os pequenos existem para provar que o caminho atual continua sendo
 * o melhor para eles; os grandes, para localizar o ponto em que ele deixa de
 * ser.
 */
const cenarios = quick
  ? [{ nome: "10 mil linhas", linhas: 10_000, abas: 1 }]
  : [
      { nome: "10 mil linhas", linhas: 10_000, abas: 1 },
      { nome: "100 mil linhas", linhas: 100_000, abas: 1 },
      // Tres colunas, e nao oito, pelo mesmo motivo ja registrado no
      // benchmark-large-import: mantem 500 mil linhas em 1,5 milhao de celulas,
      // dentro do teto de 2 milhoes do importador. Com oito colunas o proprio
      // XLSX.write falha antes de gerar a fixture, porque monta o ZIP inteiro
      // como uma string so e estoura o limite do V8.
      { nome: "500 mil linhas (3 colunas)", linhas: 500_000, abas: 1, colunas: 3 },
      { nome: "12 abas x 15 mil", linhas: 15_000, abas: 12 },
    ];

const COLUNAS = ["Id", "Data", "Setor", "Produto", "Quantidade", "Valor", "Status", "Nota"];

function linhaDeterministica(indice, colunas = COLUNAS.length) {
  const mes = String((indice % 12) + 1).padStart(2, "0");
  const dia = String((indice % 28) + 1).padStart(2, "0");
  return [
    indice,
    `2026-${mes}-${dia}`,
    `Setor ${indice % 9}`,
    `Produto com nome longo ${indice % 140}`,
    (indice % 97) + 1,
    Number(((indice * 1.37) % 9000).toFixed(2)),
    indice % 5 === 0 ? "Pendente" : "Concluido",
    `Observacao de campo numero ${indice % 300}`,
  ].slice(0, colunas);
}

function construirXlsx(linhas, abas, colunas = COLUNAS.length) {
  const wb = XLSX.utils.book_new();
  for (let aba = 0; aba < abas; aba += 1) {
    const dados = [COLUNAS.slice(0, colunas)];
    for (let linha = 1; linha <= linhas; linha += 1)
      dados.push(linhaDeterministica(linha, colunas));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dados), `Aba ${aba + 1}`);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

function construirCsv(linhas, colunas = COLUNAS.length) {
  const partes = [COLUNAS.slice(0, colunas).join(";")];
  for (let linha = 1; linha <= linhas; linha += 1)
    partes.push(linhaDeterministica(linha, colunas).join(";"));
  return Buffer.from(partes.join("\n"), "utf8");
}

function estabilizar() {
  if (!podeColetar) return;
  global.gc();
  global.gc();
}

/**
 * Soma heap e memória externa. Um `Uint8Array` grande vive fora do heap do V8,
 * então medir só `heapUsed` mostrava o ZIP expandido como zero: exatamente a
 * cópia que mais interessa nesta auditoria.
 */
function heap() {
  estabilizar();
  const uso = process.memoryUsage();
  return uso.heapUsed + uso.arrayBuffers;
}

/** Mede tempo e crescimento de heap retido por uma etapa. */
function medir(rotulo, executar) {
  const antes = heap();
  const inicio = performance.now();
  const resultado = executar();
  const ms = Math.round(performance.now() - inicio);
  const depois = heap();
  return { rotulo, ms, retidoBytes: Math.max(0, depois - antes), resultado };
}

const mib = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

const relatorio = [];

for (const cenario of cenarios) {
  const colunas = cenario.colunas ?? COLUNAS.length;
  const celulas = cenario.abas * (cenario.linhas + 1) * colunas;
  process.stdout.write(`\n== ${cenario.nome} (${celulas.toLocaleString("pt-BR")} células) ==\n`);

  // --- fixture ---
  const geracao = medir("gerar fixture xlsx", () =>
    construirXlsx(cenario.linhas, cenario.abas, colunas),
  );
  const bytes = geracao.resultado;
  const csv = construirCsv(cenario.linhas, colunas);

  // --- cópia 1: o arquivo inteiro em memória ---
  // No navegador isto é `file.arrayBuffer()`, e acontece na thread principal
  // antes de qualquer coisa. Aqui é o próprio buffer da fixture.
  const arquivoBytes = bytes.byteLength;

  // --- cópia 2: o ZIP expandido ---
  const expansao = medir("descompactar zip inteiro", () => unzipSync(bytes));
  const entradas = Object.entries(expansao.resultado);
  const expandidoBytes = entradas.reduce((soma, [, conteudo]) => soma + conteudo.byteLength, 0);
  const maiorEntrada = entradas
    .map(([nome, conteudo]) => ({ nome, bytes: conteudo.byteLength }))
    .sort((a, b) => b.bytes - a.bytes)[0];
  const sharedStrings = entradas.find(([nome]) => nome.endsWith("sharedStrings.xml"));

  // --- cópia 3: o workbook do leitor principal ---
  const leitura = medir("XLSX.read (leitor principal)", () =>
    XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      cellStyles: true,
      sheetStubs: true,
      bookDeps: true,
      dense: true,
      nodim: true,
      UTC: false,
    }),
  );

  // --- cópia 4: normalização em linhas de objeto ---
  const normalizacao = medir("normalizar em linhas", () => {
    // Sem espalhar com `push(...)`: com meio milhao de linhas isso estoura a
    // pilha de chamadas antes de medir qualquer coisa.
    const todas = [];
    for (const nome of leitura.resultado.SheetNames)
      for (const linha of XLSX.utils.sheet_to_json(leitura.resultado.Sheets[nome], {
        defval: null,
      }))
        todas.push(linha);
    return todas;
  });

  // --- CSV, para comparar o caminho de texto ---
  const csvLeitura = medir("CSV: decodificar e cortar linhas", () =>
    csv.toString("utf8").split("\n"),
  );

  const etapas = [geracao, expansao, leitura, normalizacao, csvLeitura];
  const somaCopias = arquivoBytes + expandidoBytes + leitura.retidoBytes + normalizacao.retidoBytes;

  relatorio.push({
    cenario: cenario.nome,
    celulas,
    arquivoMiB: mib(arquivoBytes),
    zipExpandidoMiB: mib(expandidoBytes),
    maiorEntradaZip: maiorEntrada ? `${maiorEntrada.nome} (${mib(maiorEntrada.bytes)} MiB)` : null,
    sharedStringsMiB: sharedStrings ? mib(sharedStrings[1].byteLength) : 0,
    workbookRetidoMiB: mib(leitura.retidoBytes),
    linhasRetidoMiB: mib(normalizacao.retidoBytes),
    somaDasCopiasMiB: mib(somaCopias),
    razaoSobreArquivo: Math.round((somaCopias / arquivoBytes) * 10) / 10,
    csvBytesMiB: mib(csv.byteLength),
    tempos: Object.fromEntries(etapas.map((e) => [e.rotulo, e.ms])),
  });

  for (const etapa of etapas)
    process.stdout.write(
      `  ${etapa.rotulo.padEnd(32)} ${String(etapa.ms).padStart(6)}ms  ${String(mib(etapa.retidoBytes)).padStart(7)} MiB retidos\n`,
    );
  process.stdout.write(
    `  ${"soma das cópias vivas".padEnd(32)} ${" ".repeat(8)}  ${String(mib(somaCopias)).padStart(7)} MiB  (${Math.round((somaCopias / arquivoBytes) * 10) / 10}x o arquivo)\n`,
  );
}

const destino = path.join(process.cwd(), "test-results");
fs.mkdirSync(destino, { recursive: true });
const saida = {
  geradoEm: new Date().toISOString(),
  medicaoDeMemoriaConfiavel: podeColetar,
  node: process.version,
  cenarios: relatorio,
};
fs.writeFileSync(path.join(destino, "import-baseline.json"), JSON.stringify(saida, null, 2) + "\n");

process.stdout.write(`\nRelatório em test-results/import-baseline.json\n`);
