import { describe, expect, it } from "vitest";

import * as XLSX from "xlsx";

import {
  compareAndRepairWithOoxml,
  decodeOoxmlText,
  inspectOoxml,
  type OoxmlInspection,
} from "@/lib/ooxml-reader";

describe("decodeOoxmlText", () => {
  it("decodifica o escape de caractere de controle encontrado em arquivo real", () => {
    expect(decodeOoxmlText("FRS-SA_x0002_009")).toBe(`FRS-SA${String.fromCodePoint(2)}009`);
  });

  it("decodifica escapes OOXML consecutivos em uma única passada", () => {
    expect(decodeOoxmlText("_x0002__x0003_")).toBe(
      `${String.fromCodePoint(2)}${String.fromCodePoint(3)}`,
    );
  });

  it("preserva como texto um escape que o Excel marcou como literal", () => {
    expect(decodeOoxmlText("_x005F_x0002_")).toBe("_x0002_");
  });
});

describe("inspectOoxml", () => {
  it("decodifica entidades XML em formatos numéricos personalizados", () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([[888715.25]]);
    worksheet["A1"]!.z = '"R$"\\ #,##0.00';
    XLSX.utils.book_append_sheet(workbook, worksheet, "Custos");

    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const cell = inspectOoxml(bytes).sheets.get("Custos")?.get("A1");

    expect(cell?.numberFormat).toBe('"R$"\\ #,##0.00');
    // Afirmar o valor esperado, e não apenas que ele difere de um pedaço de
    // entidade: `not.toBe("&quot")` passaria para `undefined`, string vazia e
    // qualquer valor errado, o que dá aparência de cobertura sem cobrir.
    expect(cell?.displayValue).toBe("R$ 888,715.25");
  });
});

/**
 * Um pacote com o que a reconstrução precisa saber carregar: data, fórmula,
 * booleano, texto, formato numérico, célula só com formatação, mesclagem e
 * linha oculta.
 */
function pacoteVariado(): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Produto", "Entrega", "Preço", "Ativo"],
    ["Resina", new Date(Date.UTC(2026, 2, 14)), 1234.5, true],
    ["Solvente", new Date(Date.UTC(2026, 3, 1)), 90, false],
  ]);
  worksheet["C2"]!.z = '"R$"\\ #,##0.00';
  worksheet["C3"] = { t: "n", v: 90, f: "SUM(C2:C2)" };
  // Uma célula que existe só para carregar formatação: ela entra no inventário
  // e não pode entrar na worksheet, porque o modelo do SheetJS não a tem.
  worksheet["D5"] = { t: "z", z: "0.00" };
  worksheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  worksheet["!rows"] = [undefined, { hidden: true }] as XLSX.RowInfo[];
  worksheet["!ref"] = "A1:D5";

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dados");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

describe("a worksheet de reparo montada sob demanda", () => {
  it("não é montada durante a verificação, que é o caminho comum", () => {
    const bytes = pacoteVariado();
    const inspecao = inspectOoxml(bytes);
    const primario = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellNF: true,
      cellText: true,
      dense: true,
    });

    // A garantia é sobre custo, então ela precisa ser observável: uma inspeção
    // cujo `workbook` lança prova que a verificação não o toca. Afirmar que a
    // comparação "funciona" não separaria montar de não montar.
    const semWorkbook: OoxmlInspection = {
      ...inspecao,
      get workbook(): XLSX.WorkBook {
        throw new Error("a verificação não pode materializar o workbook de reparo");
      },
    };

    expect(() => compareAndRepairWithOoxml(primario, semWorkbook)).not.toThrow();
  });

  it("reconstrói a aba com o mesmo conteúdo que o inventário declara", () => {
    const inspecao = inspectOoxml(pacoteVariado());
    const worksheet = inspecao.worksheetFor("Dados")!;

    expect(worksheet["!ref"]).toBe("A1:D5");
    expect(worksheet["!merges"]).toEqual([XLSX.utils.decode_range("A1:B1")]);
    expect(worksheet["!rows"]?.[1]?.hidden).toBe(true);

    // A data volta como data, e não como o número de série que o XML guarda.
    // A asserção é contra o que o inventário declara, e não contra uma data de
    // calendário: `XLSX.write` grava a serial no fuso local, então um dia fixo
    // aqui passaria ou falharia conforme a máquina.
    const entrega = worksheet["B2"] as XLSX.CellObject;
    const inventario = inspecao.sheets.get("Dados")!.get("B2")!;
    expect(entrega.t).toBe("d");
    expect(entrega.v).toBeInstanceOf(Date);
    expect(entrega.w).toBe(inventario.displayValue);
    expect(Number.isNaN((entrega.v as Date).getTime())).toBe(false);

    // O formato numérico e o texto exibido sobrevivem.
    const preco = worksheet["C2"] as XLSX.CellObject;
    expect(preco.z).toBe('"R$"\\ #,##0.00');
    expect(preco.w).toBe("R$ 1,234.50");

    // A fórmula volta sem o `=`, que é convenção do inventário e não da
    // worksheet: com ele, o SheetJS escreveria `==SUM(...)` numa exportação.
    expect((worksheet["C3"] as XLSX.CellObject).f).toBe("SUM(C2:C2)");
    expect((worksheet["D2"] as XLSX.CellObject).t).toBe("b");
    expect((worksheet["D2"] as XLSX.CellObject).v).toBe(true);

    // A célula só com formatação está no inventário e não na worksheet.
    expect(inspecao.sheets.get("Dados")?.has("D5")).toBe(true);
    expect(worksheet["D5"]).toBeUndefined();
  });

  it("reconstrói uma célula sozinha sem montar a aba inteira", () => {
    const inspecao = inspectOoxml(pacoteVariado());

    expect(inspecao.cellFor("Dados", "A2")).toEqual({ t: "s", v: "Resina", w: "Resina" });
    // Célula sem valor e sem fórmula não vira célula, aqui pelo mesmo critério
    // que a aba inteira usa.
    expect(inspecao.cellFor("Dados", "D5")).toBeUndefined();
    expect(inspecao.cellFor("Inexistente", "A1")).toBeUndefined();
  });

  it("devolve sempre o mesmo workbook, porque quem o pede escreve nele", () => {
    const inspecao = inspectOoxml(pacoteVariado());

    // O caminho de fallback importa este workbook e marca cada aba com um
    // diagnóstico. Uma cópia nova a cada leitura perderia a marca.
    expect(inspecao.workbook).toBe(inspecao.workbook);
    expect(inspecao.workbook.SheetNames).toEqual(inspecao.sheetNames);
  });

  it("recupera uma aba inteira que o leitor principal perdeu", () => {
    const bytes = pacoteVariado();
    const inspecao = inspectOoxml(bytes);
    const primario: XLSX.WorkBook = { SheetNames: [], Sheets: {} };

    const divergencias = compareAndRepairWithOoxml(primario, inspecao);

    expect(primario.SheetNames).toEqual(["Dados"]);
    expect((primario.Sheets["Dados"]!["A2"] as XLSX.CellObject).v).toBe("Resina");
    expect(divergencias.every((item) => item.repaired)).toBe(true);
  });
});
