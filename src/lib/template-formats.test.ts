import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readWorkbookBytes } from "@/lib/workbook-reader";

/**
 * `.xltx` e `.xltm` são modelos: o mesmo pacote OOXML de um `.xlsx`/`.xlsm`,
 * com um content-type diferente para o Excel abrir uma cópia em vez do
 * arquivo. O app declara suportar os dois, mas isso nunca tinha sido
 * verificado com arquivo real — só a extensão aparecia nas listas de aceite.
 *
 * Aqui o modelo é derivado de uma planilha real do corpus local, trocando
 * apenas o content-type (a mesma transformação de
 * `scripts/derive-real-templates.mjs`), e o resultado da leitura é comparado
 * com o do arquivo de origem. Um modelo é o mesmo conteúdo com outro
 * carimbo: se a leitura divergir, o suporte é só nominal.
 */
const WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const MACRO_CONTENT_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const TEMPLATE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml";
const MACRO_TEMPLATE_CONTENT_TYPE = "application/vnd.ms-excel.template.macroEnabled.main+xml";

function toTemplate(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const parts = unzipSync(bytes);
  const contentTypes = strFromU8(parts["[Content_Types].xml"]!);
  expect(contentTypes).toContain(from);
  parts["[Content_Types].xml"] = strToU8(contentTypes.replace(from, to));
  return zipSync(parts);
}

/** Resumo estável para comparar duas leituras sem depender de identidade. */
function shape(path: string, bytes: Uint8Array) {
  return readWorkbookBytes(bytes, path).map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.length,
    columns: Object.keys(sheet.rows[0] ?? {}),
    divergences: sheet.diagnostics?.readerDivergences?.length ?? 0,
  }));
}

const candidates = [
  {
    source: "FRS-QA-BR-413 Brasil - Cronograma de Calibrao_2023 Rev.00.xlsx",
    extension: "xltx",
    from: WORKBOOK_CONTENT_TYPE,
    to: TEMPLATE_CONTENT_TYPE,
  },
  {
    source: "FRS-SA-019 Suape - Plano de ao - Equipe de Segurana dos Alimentos (ESA).xlsm",
    extension: "xltm",
    from: MACRO_CONTENT_TYPE,
    to: MACRO_TEMPLATE_CONTENT_TYPE,
  },
] as const;

const fixtures = candidates
  .map((item) => {
    const path = [`upload/${item.source}`, `../upload/${item.source}`].find(existsSync);
    return path ? { ...item, path } : null;
  })
  .filter((item): item is (typeof candidates)[number] & { path: string } => item !== null);

describe.skipIf(!fixtures.length)("modelos .xltx e .xltm", () => {
  for (const fixture of fixtures) {
    it(`lê um .${fixture.extension} igual ao ${basename(fixture.path)} de origem`, () => {
      const original = new Uint8Array(readFileSync(fixture.path));
      const template = toTemplate(original, fixture.from, fixture.to);
      const templatePath = `modelo.${fixture.extension}`;

      const esperado = shape(fixture.path, original);
      const obtido = shape(templatePath, template);

      expect(obtido.length).toBeGreaterThan(0);
      expect(obtido).toEqual(esperado);
      // Divergência aqui significaria que o leitor principal e a verificação
      // OOXML independente discordam sobre as células do modelo.
      expect(obtido.every((sheet) => sheet.divergences === 0)).toBe(true);
    });
  }
});
