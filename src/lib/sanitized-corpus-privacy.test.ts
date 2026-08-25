import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectOoxml } from "@/lib/ooxml-reader";

/**
 * Varredura de privacidade do corpus sanitizado.
 *
 * Não substitui o `corpus:validate`, que compara o arquivo sanitizado contra o
 * original e por isso só roda na máquina que tem os originais e o salt. Este
 * teste olha apenas o resultado, e é a única verificação do corpus real que
 * qualquer pessoa com os arquivos consegue repetir sem os originais.
 *
 * Pula quando o diretório não existe, que é o caso da CI: `sanitized-real/`
 * está no `.gitignore` de propósito, então as planilhas reais nunca entram no
 * repositório nem passam pela CI. Vale saber disso ao ler o gate de paridade:
 * na CI ele mede só o corpus gerado.
 */
const raiz = process.env["OLI_SANITIZED_CORPUS_DIR"] ?? "test-fixtures/sanitized-real";

const padroes: { nome: string; regex: RegExp }[] = [
  { nome: "e-mail", regex: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { nome: "CPF", regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
  { nome: "CNPJ", regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/ },
  { nome: "telefone", regex: /\b\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/ },
  { nome: "URL", regex: /https?:\/\/[^\s"]+/ },
  { nome: "caminho de rede", regex: /\\\\[\w-]+\\/ },
  { nome: "caminho local", regex: /[A-Za-z]:\\Users\\/ },
];

describe.skipIf(!existsSync(raiz))("privacidade do corpus sanitizado", () => {
  it("nenhuma célula carrega identificador pessoal ou caminho de origem", () => {
    const arquivos = readdirSync(raiz).filter((nome) => /\.(xlsx|xlsm)$/i.test(nome));
    expect(arquivos.length).toBeGreaterThan(0);

    const achados: string[] = [];
    for (const arquivo of arquivos) {
      const inspecao = inspectOoxml(readFileSync(join(raiz, arquivo)));
      for (const [aba, mapa] of inspecao.sheets) {
        for (const [endereco, celula] of mapa) {
          const texto = `${celula.displayValue ?? ""} ${String(celula.rawValue ?? "")}`;
          for (const { nome, regex } of padroes) {
            const encontrado = texto.match(regex);
            if (encontrado)
              achados.push(`${arquivo} ${aba}!${endereco} ${nome}: ${encontrado[0].slice(0, 40)}`);
          }
        }
      }
    }
    expect(achados).toEqual([]);
    // Prazo folgado de propósito: são quase 200 mil células contra sete
    // padrões, e o teto padrão de 5s do Vitest derruba isso quando a suíte
    // inteira disputa CPU. É lento por varrer tudo, que é o ponto.
  }, 180_000);

  it("o manifesto local corresponde byte a byte aos arquivos presentes", async () => {
    const { createHash } = await import("node:crypto");
    const manifesto = JSON.parse(readFileSync(join(raiz, "manifest.local.json"), "utf8")) as {
      cases: { file: string; sha256: string }[];
    };
    const divergentes = manifesto.cases.filter((caso) => {
      const caminho = join(raiz, caso.file);
      if (!existsSync(caminho)) return true;
      return createHash("sha256").update(readFileSync(caminho)).digest("hex") !== caso.sha256;
    });
    expect(divergentes.map((caso) => caso.file)).toEqual([]);

    // Nenhum arquivo solto: um sanitizado fora do manifesto entraria na
    // paridade sem registro de origem nem de quanto foi sanitizado.
    const arquivos = readdirSync(raiz).filter((nome) => /\.(xlsx|xlsm)$/i.test(nome));
    const noManifesto = new Set(manifesto.cases.map((caso) => caso.file));
    expect(arquivos.filter((nome) => !noManifesto.has(nome))).toEqual([]);
  });
});
