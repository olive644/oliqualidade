import { afterEach, describe, expect, it, vi } from "vitest";
import { askGemini } from "@/lib/gemini-client";
import type { Dashboard, SheetData } from "@/lib/types";
import type { LiveDashboardContext } from "@/lib/assistant-context";

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
const liveView: LiveDashboardContext = {
  capturedAt: "2026-08-11T12:00:00.000Z",
  source: "current-filtered-view",
  dashboard: "Painel",
  sheet: "Vendas",
  totalRows: 1,
  visibleRows: 1,
  search: "",
  filters: [],
  sort: null,
  widgets: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("cliente Gemini", () => {
  it("envia somente o dashboard e a aba ativos", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ answer: "Total 10" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      askGemini("Qual é o total?", dashboard, sheet, sheet.rows, liveView),
    ).resolves.toBe("Total 10");
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
    await expect(askGemini("Resumo", dashboard, sheet, sheet.rows, liveView)).rejects.toThrow(
      "Gemini não configurado",
    );
  });

  it("não expõe erro técnico quando a resposta não é JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 })),
    );
    await expect(askGemini("Resumo", dashboard, sheet, sheet.rows, liveView)).rejects.toThrow(
      "indisponível",
    );
  });

  it("envia as linhas filtradas, a visão viva e o histórico atual", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ answer: "Tudo certo" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      askGemini("O que estou vendo?", dashboard, sheet, [{ Valor: 20 }], liveView, [
        { role: "assistant", text: "Pergunte sobre a tela." },
      ]),
    ).resolves.toBe("Tudo certo");

    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    const payload = JSON.parse(String(init.body)) as {
      history: unknown[];
      dashboard: { rows: unknown[]; liveView: LiveDashboardContext };
    };
    expect(payload.dashboard.rows).toEqual([{ Valor: 20 }]);
    expect(payload.dashboard.liveView.visibleRows).toBe(1);
    expect(payload.history).toEqual([{ role: "assistant", text: "Pergunte sobre a tela." }]);
  });
});
