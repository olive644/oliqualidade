import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { sheetsWithData } from "@/lib/import";

/**
 * Rede de proteção da normalização sobre planilhas reais locais.
 *
 * Ela existe porque faltava. O corpus real cobria o **leitor** (células, contra
 * a inspeção OOXML e contra o núcleo Rust), mas nada exercitava
 * `sheetsWithData` sobre arquivo real: detecção de cabeçalho, divisão em
 * regiões e forma das linhas ficavam cobertas só por planilha sintética. O
 * teste que existia para isso procura cinco arquivos por nome fixo em
 * `upload/`, e nenhum deles está presente neste checkout, então ele é pulado
 * inteiro sem que ninguém perceba.
 *
 * O modo de uso é de mestre dourado, porque o corpus é local e não versionado
 * (ver `docs/WASM_CORPUS_SANITIZATION.md`) e nenhuma expectativa fixa poderia
 * valer para outra máquina:
 *
 *     OLI_IMPORT_PARITY=write npx vitest run src/lib/import-parity.test.ts
 *     npx vitest run src/lib/import-parity.test.ts
 *
 * A primeira execução grava a referência em `test-results/`, que é ignorado
 * pelo Git. As seguintes comparam. Sem referência gravada, o teste é pulado, e
 * é por isso que ele não quebra a CI, onde o corpus não existe.
 *
 * A referência guarda nome de aba, quantidade de linhas, chaves de coluna e um
 * hash dos valores. **Nenhum valor de célula é gravado.**
 */

const RAIZES = ["test-fixtures/sanitized-real", "upload"];
const REFERENCIA = join("test-results", "import-parity.json");
const modo = process.env["OLI_IMPORT_PARITY"];

function planilhasLocais(): string[] {
  const encontrados: string[] = [];
  for (const raiz of RAIZES) {
    if (!existsSync(raiz)) continue;
    for (const nome of readdirSync(raiz).sort())
      if (/\.(xlsx|xlsm|xltx|xltm)$/i.test(nome)) encontrados.push(join(raiz, nome));
  }
  return encontrados;
}

type ResumoDeAba = { aba: string; linhas: number; colunas: string[]; valores: string };

function resumir(caminho: string): ResumoDeAba[] {
  const workbook = XLSX.read(new Uint8Array(readFileSync(caminho)), {
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
  });
  return sheetsWithData(workbook).map((opcao) => {
    const hash = createHash("sha256");
    for (const linha of opcao.rows)
      for (const chave of Object.keys(linha).sort()) hash.update(`${chave}=${linha[chave] ?? ""};`);
    return {
      aba: opcao.name,
      linhas: opcao.rows.length,
      colunas: [...new Set(opcao.rows.flatMap((linha) => Object.keys(linha)))].sort(),
      valores: hash.digest("hex").slice(0, 16),
    };
  });
}

/**
 * Ler e normalizar o corpus inteiro leva mais que o prazo padrão de 5s do
 * vitest: são dezenas de arquivos reais, e o custo é a leitura de verdade.
 */
const PRAZO_DO_CORPUS = 300_000;

const arquivos = planilhasLocais();
const temReferencia = existsSync(REFERENCIA);

describe.skipIf(!arquivos.length)("paridade da normalização sobre planilhas reais locais", () => {
  it("encontra o corpus local", () => {
    expect(arquivos.length).toBeGreaterThan(0);
  });

  it.skipIf(modo !== "write")("grava a referência", { timeout: PRAZO_DO_CORPUS }, () => {
    const resumo: Record<string, ResumoDeAba[] | { erro: string }> = {};
    for (const caminho of arquivos) {
      try {
        resumo[basename(caminho)] = resumir(caminho);
      } catch (erro) {
        // Arquivo que o leitor recusa hoje continua recusado depois: a
        // mensagem faz parte do comportamento a preservar.
        resumo[basename(caminho)] = {
          erro: erro instanceof Error ? erro.message : "falha desconhecida",
        };
      }
    }
    mkdirSync("test-results", { recursive: true });
    writeFileSync(REFERENCIA, `${JSON.stringify(resumo, null, 2)}\n`);
    expect(Object.keys(resumo)).toHaveLength(arquivos.length);
  });

  it.skipIf(modo === "write" || !temReferencia)(
    "mantém o resultado idêntico ao da referência gravada",
    { timeout: PRAZO_DO_CORPUS },
    () => {
      const referencia = JSON.parse(readFileSync(REFERENCIA, "utf8")) as Record<string, unknown>;
      const divergentes: string[] = [];

      for (const caminho of arquivos) {
        const nome = basename(caminho);
        let atual: unknown;
        try {
          atual = resumir(caminho);
        } catch (erro) {
          atual = { erro: erro instanceof Error ? erro.message : "falha desconhecida" };
        }
        if (JSON.stringify(referencia[nome]) !== JSON.stringify(atual)) divergentes.push(nome);
      }

      // A lista traz só nomes de arquivo, nunca conteúdo: ela pode acabar num
      // log de CI ou numa mensagem de erro colada em qualquer lugar.
      expect(divergentes).toEqual([]);
    },
  );
});
