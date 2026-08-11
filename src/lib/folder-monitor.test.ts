import { describe, expect, it } from "vitest";
import {
  fileChanged,
  fingerprint,
  isSupportedWorkbook,
  listSupportedWorkbooks,
  pickFolderWorkbook,
  type LocalDirectoryHandle,
  type LocalFileHandle,
} from "@/lib/folder-monitor";

describe("folder monitor", () => {
  it("detecta alteração pela data ou tamanho do arquivo", () => {
    const previous = fingerprint({ lastModified: 10, size: 100 } as File);
    expect(fileChanged(previous, { lastModified: 10, size: 100 } as File)).toBe(false);
    expect(fileChanged(previous, { lastModified: 11, size: 100 } as File)).toBe(true);
    expect(fileChanged(previous, { lastModified: 10, size: 101 } as File)).toBe(true);
  });

  it("aceita formatos de planilha suportados e rejeita outros arquivos", () => {
    expect(isSupportedWorkbook("vendas.XLSX")).toBe(true);
    expect(isSupportedWorkbook("dados.csv")).toBe(true);
    expect(isSupportedWorkbook("modelo.xlsm")).toBe(true);
    expect(isSupportedWorkbook("notas.txt")).toBe(false);
  });

  it("restringe a escolha ao arquivo contido na pasta autorizada", async () => {
    const file = { name: "vendas.xlsx", size: 12, lastModified: 30 } as File;
    const handle = {
      kind: "file",
      name: file.name,
      getFile: async () => file,
    } satisfies LocalFileHandle;
    const directory = {
      kind: "directory",
      name: "Relatórios",
      resolve: async () => [file.name],
      getFileHandle: async () => handle,
      values: async function* () {
        yield handle;
        yield { kind: "file" as const, name: "custos.csv", getFile: async () => file };
        yield { kind: "file" as const, name: "leia-me.txt", getFile: async () => file };
      },
    } satisfies LocalDirectoryHandle;
    const win = {
      showDirectoryPicker: async () => directory,
      showOpenFilePicker: async () => [handle],
    } as unknown as Window;

    await expect(pickFolderWorkbook(win)).resolves.toMatchObject({
      directory,
      handle,
      file,
      workbookNames: ["custos.csv", "vendas.xlsx"],
    });
  });

  it("conta somente planilhas legíveis na pasta", async () => {
    const directory = {
      kind: "directory" as const,
      name: "Dados",
      resolve: async () => null,
      getFileHandle: async () => {
        throw new Error("unused");
      },
      values: async function* () {
        for (const name of ["vendas.xlsx", "custos.CSV", "notas.txt", "arquivo.pdf"])
          yield { kind: "file" as const, name, getFile: async () => ({ name }) as File };
      },
    };
    await expect(listSupportedWorkbooks(directory)).resolves.toEqual(["custos.CSV", "vendas.xlsx"]);
  });

  it("usa entries do Chrome para contar duas planilhas", async () => {
    const files = ["janeiro.xlsx", "fevereiro.xlsx", "anotacoes.docx"];
    const directory = {
      kind: "directory" as const,
      name: "Vendas",
      resolve: async () => null,
      getFileHandle: async () => {
        throw new Error("unused");
      },
      entries: async function* () {
        for (const name of files)
          yield [
            name,
            { kind: "file" as const, name, getFile: async () => ({ name }) as File },
          ] as [string, LocalFileHandle];
      },
    };
    await expect(listSupportedWorkbooks(directory)).resolves.toEqual([
      "fevereiro.xlsx",
      "janeiro.xlsx",
    ]);
  });

  it("informa quando o navegador não oferece acesso seguro a pastas", async () => {
    await expect(pickFolderWorkbook({} as Window)).rejects.toThrow("unsupported");
  });
});
