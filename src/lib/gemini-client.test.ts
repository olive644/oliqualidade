import { afterEach, describe, expect, it, vi } from "vitest";
import { askGemini } from "@/lib/gemini-client";
import type { Dashboard, SheetData } from "@/lib/types";

const sheet: SheetData = {
  name: "Vendas",
  rows: [{ Valor: 10 }],
  columns: [{ key: "Valor", label: "Valor", kind: "number", visible: true, description: "" }],
  filters: [],
};
const dashboard: Dashboard = {
  id: "d1",
  name: "Painel",
  sheets: [sheet],
  activeSheetIndex: 0,
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
};

afterEach(() => vi.unstubAllGlobals());

describe("cliente Gemini", () => {
  it("envia somente o dashboard e a aba ativos", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ answer: "Total 10" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(askGemini("Qual é o total?", dashboard, sheet)).resolves.toBe("Total 10");
    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    const body = JSON.parse(String(init.body)) as { dashboard: { sheetName: string } };
    expect(body.dashboard.sheetName).toBe("Vendas");
  });

  it("propaga a mensagem segura do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Gemini não configurado no servidor." }), {
            status: 503,
          }),
      ),
    );
    await expect(askGemini("Resumo", dashboard, sheet)).rejects.toThrow("Gemini não configurado");
  });

  it("não expõe erro técnico quando a resposta não é JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );
    await expect(askGemini("Resumo", dashboard, sheet)).rejects.toThrow("indisponível");
  });
});
