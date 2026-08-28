import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Empty } from "./empty";

/**
 * O que se verifica aqui é a promessa da barra de leitura: ela aparece quando
 * existe medida real e some quando não existe. Uma barra que anda sozinha numa
 * etapa que ninguém consegue medir é pior que nenhuma barra, porque promete
 * uma previsão que o código não tem.
 */

const base = {
  onUpload: () => {},
  onDropFile: () => {},
  onFolder: () => {},
  onDemo: () => {},
  url: "",
  setUrl: () => {},
  sheet: () => {},
  loading: true,
  loadingLabel: "Conferindo valores com o XML original…",
  loadingDetail: null as string | null,
  loadingRatio: null as number | null,
  cancelImport: () => {},
  editor: false,
  setEditor: () => {},
  paste: "",
  setPaste: () => {},
  pasteData: () => {},
  backHome: () => {},
  showBack: false,
  theme: "light",
  toggleTheme: () => {},
  importError: null,
  privateMode: false,
  togglePrivateMode: () => {},
  hydrated: true,
};

describe("tela inicial durante a leitura", () => {
  it("desenha a barra com a medida da etapa quando ela existe", () => {
    render(<Empty {...base} loadingDetail="42% · 3 abas encontradas" loadingRatio={0.42} />);

    const barra = screen.getByRole("progressbar", { name: "Progresso da leitura da planilha" });
    expect(barra.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText("42% · 3 abas encontradas")).toBeTruthy();
    expect(screen.getByText("Conferindo valores com o XML original…")).toBeTruthy();
  });

  it("não desenha barra nenhuma na etapa que não sabe medir", () => {
    render(<Empty {...base} loadingLabel="Lendo células, fórmulas e formatação…" />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    // A animação do Oli continua dizendo que algo acontece, sem prometer fração.
    expect(screen.getByRole("status", { name: "Carregando" })).toBeTruthy();
    expect(screen.getByText("Preparando seus dados.")).toBeTruthy();
  });

  it("não mostra leitura nenhuma quando não há importação em curso", () => {
    render(<Empty {...base} loading={false} loadingRatio={0.5} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
