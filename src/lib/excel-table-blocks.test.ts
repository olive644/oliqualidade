import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildTableBlocksGrid, detectTableBlockGroup } from "./excel-table-blocks";
import type { StructuredTableDiagnostic } from "@/lib/workbook-metadata";

const tabela = (
  name: string,
  range: string,
  columns: string[],
  totalsRowCount = 1,
): StructuredTableDiagnostic => ({
  name,
  range,
  columns,
  calculatedColumns: [],
  totalsRowCount,
  headerRowCount: 1,
});

const orcamento = [
  tabela("Moradia", "B10:E21", ["MORADIA", "Custo previsto", "Custo Real", "Diferença"]),
  tabela("Entretenimento", "G10:J20", [
    "ENTRETENIMENTO",
    "Custo previsto",
    "Custo Real",
    "Diferença",
  ]),
  tabela("Transporte", "B23:E31", ["TRANSPORTE", "Custo previsto", "Custo Real", "Diferença"]),
];

describe("detectTableBlockGroup", () => {
  it("reconhece blocos com a mesma estrutura e ordena por posição na planilha", () => {
    const grupo = detectTableBlockGroup(orcamento);
    expect(grupo?.sharedColumns).toEqual(["Custo previsto", "Custo Real", "Diferença"]);
    expect(grupo?.blocks.map((block) => block.name)).toEqual([
      "Moradia",
      "Entretenimento",
      "Transporte",
    ]);
  });

  it("usa um rótulo genérico quando cada bloco nomeia a primeira coluna por si", () => {
    // "MORADIA" não serve de nome para uma coluna que vai conter itens dos
    // doze blocos.
    expect(detectTableBlockGroup(orcamento)?.itemLabel).toBe("Item");
  });

  it("mantém o nome da primeira coluna quando todos os blocos usam o mesmo", () => {
    const iguais = orcamento.map((table) => ({
      ...table,
      columns: ["Item", ...table.columns.slice(1)],
    }));
    expect(detectTableBlockGroup(iguais)?.itemLabel).toBe("Item");
  });

  it("troca sublinhado por espaço no nome do bloco", () => {
    const comSublinhado = [
      tabela("Animais_de_estimação", "B46:E52", ["ANIMAIS", "Custo previsto", "Custo Real"]),
      tabela("Assessoria_jurídica", "G50:J55", ["ASSESSORIA", "Custo previsto", "Custo Real"]),
    ];
    expect(detectTableBlockGroup(comSublinhado)?.blocks.map((b) => b.name)).toEqual([
      "Animais de estimação",
      "Assessoria jurídica",
    ]);
  });

  it("não unifica uma tabela sozinha", () => {
    expect(detectTableBlockGroup([orcamento[0]!])).toBeNull();
  });

  it("não unifica blocos com colunas diferentes", () => {
    const incompativel = [
      orcamento[0]!,
      tabela("Outra", "G10:J20", ["OUTRA", "Quantidade", "Responsável", "Prazo"]),
    ];
    expect(detectTableBlockGroup(incompativel)).toBeNull();
  });

  it("não unifica quando o grupo compatível é minoria na aba", () => {
    // Duas tabelas iguais entre dez diferentes são coincidência, não um
    // formato de blocos.
    const diferentes = Array.from({ length: 8 }, (_, index) =>
      tabela(`T${index}`, `A${index * 5 + 1}:D${index * 5 + 4}`, [
        `T${index}`,
        `Coluna ${index}`,
        "Outra",
        "Mais",
      ]),
    );
    expect(detectTableBlockGroup([...orcamento.slice(0, 2), ...diferentes])).toBeNull();
  });
});

describe("buildTableBlocksGrid", () => {
  const planilha = XLSX.utils.aoa_to_sheet([
    ["MORADIA", "Custo previsto", "Custo Real"],
    ["Aluguel", 1500, 1400],
    ["Luz", 50, 60],
    ["Total", 1550, 1460],
  ]);
  const colunas = ["Custo previsto", "Custo Real"];
  const grupo = detectTableBlockGroup([
    tabela("Moradia", "A1:C4", ["MORADIA", ...colunas]),
    tabela("Transporte", "A1:C4", ["TRANSPORTE", ...colunas]),
  ]);

  it("descarta o cabeçalho e a linha de totais de cada bloco", () => {
    const grade = buildTableBlocksGrid((address) => planilha[address], {
      ...grupo!,
      blocks: [grupo!.blocks[0]!],
    });
    // Coluna C da grade unificada: A é o bloco, B é o item, e a partir de C
    // vêm as colunas compartilhadas.
    const valores = [...(grade?.cells.entries() ?? [])]
      .filter(([address]) => address.startsWith("C"))
      .map(([, cell]) => cell.v);
    expect(valores).toEqual(["Custo previsto", 1500, 50]);
  });

  it("escreve o nome do bloco em cada linha e guarda o endereço de origem", () => {
    const grade = buildTableBlocksGrid((address) => planilha[address], {
      ...grupo!,
      blocks: [grupo!.blocks[0]!],
    });
    expect(grade?.cells.get("A2")?.v).toBe("Moradia");
    // A célula B2 do arquivo (o aluguel) foi para C2 da grade unificada,
    // depois das colunas de bloco e de item.
    expect(grade?.addressMap.get("B2")).toBe("C2");
  });

  it("devolve null quando nenhum bloco tem linha de dado", () => {
    const vazia = XLSX.utils.aoa_to_sheet([
      ["MORADIA", "Custo previsto", "Custo Real"],
      ["Total", 0, 0],
    ]);
    const grupoVazio = detectTableBlockGroup([
      tabela("Moradia", "A1:C2", ["MORADIA", ...colunas]),
      tabela("Transporte", "A1:C2", ["TRANSPORTE", ...colunas]),
    ]);
    expect(
      buildTableBlocksGrid((address) => vazia[address], {
        ...grupoVazio!,
        blocks: [grupoVazio!.blocks[0]!],
      }),
    ).toBeNull();
  });
});
