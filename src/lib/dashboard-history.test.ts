import { describe, expect, it } from "vitest";
import {
  describeChange,
  pruneVersions,
  shouldCapture,
  snapshotDashboard,
  type DashboardSnapshot,
  type DashboardVersion,
} from "./dashboard-history";
import type { Dashboard, Widget } from "@/lib/types";

const widget = (id: string): Widget => ({ id, type: "bar", span: 1, size: "md" }) as Widget;

const painel = (patch: Partial<Dashboard> = {}): Dashboard =>
  ({
    id: "d1",
    name: "Painel",
    activeSheetIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    sheets: [
      {
        name: "Dados",
        rows: [{ a: 1 }],
        columns: [{ key: "a", label: "A", kind: "number", visible: true, description: "" }],
        filters: [],
        widgets: [widget("w1")],
      },
    ],
    ...patch,
  }) as Dashboard;

const snap = (d: Dashboard) => snapshotDashboard(d);

describe("snapshotDashboard", () => {
  it("guarda a montagem e deixa as linhas de fora", () => {
    // Guardar as linhas multiplicaria o tamanho de cada versão pelo tamanho
    // da base, e restaurar ressuscitaria dados já substituídos.
    const capturado = snap(painel()) as DashboardSnapshot & { sheets: { rows?: unknown }[] };
    expect(capturado.sheets[0]).not.toHaveProperty("rows");
    expect(capturado.sheets[0]?.widgets).toHaveLength(1);
  });

  it("guarda só o essencial de cada coluna", () => {
    expect(Object.keys(snap(painel()).sheets[0]!.columns[0]!).sort()).toEqual([
      "key",
      "kind",
      "label",
      "visible",
    ]);
  });
});

describe("shouldCapture", () => {
  it("captura a primeira versão", () => {
    expect(shouldCapture(undefined, snap(painel()))).toBe(true);
  });

  it("não captura quando nada mudou", () => {
    // Sem isso, cada tecla digitada viraria uma versão e o histórico ficaria
    // inútil por excesso.
    expect(shouldCapture(snap(painel()), snap(painel()))).toBe(false);
  });

  it("captura quando a montagem muda", () => {
    const depois = painel();
    depois.sheets[0]!.widgets = [widget("w1"), widget("w2")];
    expect(shouldCapture(snap(painel()), snap(depois))).toBe(true);
  });
});

describe("describeChange", () => {
  it("conta widgets acrescentados", () => {
    const depois = painel();
    depois.sheets[0]!.widgets = [widget("w1"), widget("w2")];
    expect(describeChange(snap(painel()), snap(depois))).toContain("1 widget a mais");
  });

  it("conta widgets removidos", () => {
    const depois = painel();
    depois.sheets[0]!.widgets = [];
    expect(describeChange(snap(painel()), snap(depois))).toContain("1 widget a menos");
  });

  it("reconhece filtro acrescentado", () => {
    const depois = painel();
    depois.sheets[0]!.filters = [{ key: "a", value: "1", min: "", max: "" }];
    expect(describeChange(snap(painel()), snap(depois))).toContain("1 filtro a mais");
  });

  it("reconhece renomeação", () => {
    expect(describeChange(snap(painel()), snap(painel({ name: "Outro" })))).toContain(
      'renomeado para "Outro"',
    );
  });

  it("descreve a primeira versão sem inventar comparação", () => {
    expect(describeChange(undefined, snap(painel()))).toBe("Primeira versão guardada");
  });
});

describe("pruneVersions", () => {
  const versao = (id: string, createdAt: number, manual = false): DashboardVersion => ({
    id,
    dashboardId: "d1",
    createdAt,
    summary: "",
    manual,
    snapshot: snap(painel()),
  });

  it("mantém as mais recentes quando passa do limite", () => {
    const lista = Array.from({ length: 5 }, (_, i) => versao(`v${i}`, i));
    expect(pruneVersions(lista, 3).map((v) => v.id)).toEqual(["v4", "v3", "v2"]);
  });

  it("preserva versão marcada pelo usuário mesmo sendo antiga", () => {
    // Ele a criou justamente porque queria poder voltar ali depois.
    const lista = [
      versao("antiga-manual", 0, true),
      ...Array.from({ length: 5 }, (_, i) => versao(`v${i}`, i + 1)),
    ];
    const mantidas = pruneVersions(lista, 3).map((v) => v.id);
    expect(mantidas).toContain("antiga-manual");
    expect(mantidas).toHaveLength(3);
  });

  it("não mexe numa lista dentro do limite", () => {
    const lista = [versao("a", 1), versao("b", 2)];
    expect(pruneVersions(lista, 5)).toHaveLength(2);
  });
});
