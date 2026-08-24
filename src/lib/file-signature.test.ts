import { describe, expect, it } from "vitest";
import {
  checkWorkbookContent,
  detectFileSignature,
  isWorkbookContentRejection,
} from "./file-signature";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(64).fill(0x41)]);
const texto = (conteudo: string) => new TextEncoder().encode(conteudo);

describe("detectFileSignature", () => {
  it("reconhece pacote ZIP, que é a base dos formatos modernos", () => {
    expect(detectFileSignature(bytes(0x50, 0x4b, 0x03, 0x04)).container).toBe("zip");
  });

  it("reconhece OLE2, que é a base do Excel antigo", () => {
    expect(
      detectFileSignature(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)).container,
    ).toBe("ole2");
  });

  it("reconhece texto", () => {
    expect(detectFileSignature(texto("nome;valor\nA;1\n")).container).toBe("text");
  });

  it("nomeia formatos que chegam renomeados com frequência", () => {
    expect(detectFileSignature(bytes(0x25, 0x50, 0x44, 0x46)).foreignFormat).toBe("PDF");
    expect(detectFileSignature(bytes(0x89, 0x50, 0x4e, 0x47)).foreignFormat).toBe("imagem PNG");
  });

  it("não confunde binário desconhecido com texto", () => {
    // Byte zero é o que separa texto de binário na prática.
    expect(detectFileSignature(new Uint8Array([0x01, 0x00, 0x02, 0x00])).container).toBe("unknown");
  });

  it("tolera um caractere de controle solto em exportação de sistema legado", () => {
    // Um controle perdido em arquivo de tamanho real fica muito abaixo do
    // limite de 5%; o que reprova é densidade de binário, não um byte isolado.
    const linhas = texto("nome;valor\n".repeat(40));
    expect(detectFileSignature(new Uint8Array([...linhas, 0x07])).container).toBe("text");
  });

  it("trata arquivo vazio como não reconhecido", () => {
    expect(detectFileSignature(new Uint8Array()).container).toBe("unknown");
  });
});

describe("isWorkbookContentRejection", () => {
  it("reconhece as duas recusas que a checagem produz", () => {
    // Trava o acoplamento: a tela depende deste reconhecimento para nao trocar
    // a explicacao util pela mensagem generica de formato invalido. Mudar o
    // texto da recusa sem atualizar o reconhecimento quebra aqui, e nao no uso.
    const pdf = checkWorkbookContent(bytes(0x25, 0x50, 0x44, 0x46), "a.xlsx");
    const lixo = checkWorkbookContent(new Uint8Array([0x01, 0x00, 0x02, 0x00]), "a.xlsx");
    expect(pdf.ok).toBe(false);
    expect(lixo.ok).toBe(false);
    if (!pdf.ok) expect(isWorkbookContentRejection(pdf.message)).toBe(true);
    if (!lixo.ok) expect(isWorkbookContentRejection(lixo.message)).toBe(true);
  });

  it("nao confunde com outras falhas de leitura", () => {
    expect(isWorkbookContentRejection("Esta planilha e protegida por senha.")).toBe(false);
  });
});

describe("checkWorkbookContent", () => {
  it("recusa arquivo que não é planilha, dizendo o que ele é", () => {
    const resultado = checkWorkbookContent(bytes(0x25, 0x50, 0x44, 0x46), "relatorio.xlsx");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.message).toContain("PDF");
  });

  it("aceita e sinaliza um .xls antigo renomeado para .xlsx", () => {
    // Recusar seria perder um arquivo que o leitor consegue abrir; o certo é
    // ler pelo conteúdo e avisar que o nome não corresponde.
    const resultado = checkWorkbookContent(
      bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1),
      "vendas.xlsx",
    );
    expect(resultado).toMatchObject({ ok: true, container: "ole2", renamed: true });
  });

  it("aceita tabela HTML exportada com nome .xls, caso comum em sistema corporativo", () => {
    const resultado = checkWorkbookContent(texto("<html><table><tr><td>1</td>"), "extrato.xls");
    expect(resultado).toMatchObject({ ok: true, container: "text", renamed: true });
  });

  it("não marca como renomeado quando conteúdo e extensão combinam", () => {
    expect(checkWorkbookContent(bytes(0x50, 0x4b, 0x03, 0x04), "base.xlsx")).toMatchObject({
      ok: true,
      renamed: false,
    });
  });

  it("aceita CSV sem exigir assinatura, porque texto não tem uma", () => {
    expect(checkWorkbookContent(texto("a,b\n1,2\n"), "dados.csv")).toMatchObject({
      ok: true,
      container: "text",
      renamed: false,
    });
  });
});
