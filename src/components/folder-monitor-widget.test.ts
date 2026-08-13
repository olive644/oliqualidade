import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FolderMonitorWidget } from "@/components/folder-monitor-widget";

describe("FolderMonitorWidget", () => {
  it("resume somente as planilhas compatíveis reais e identifica o arquivo ativo", () => {
    const html = renderToStaticMarkup(
      createElement(FolderMonitorWidget, {
        monitor: {
          folderName: "Qualidade Suape",
          fileName: "cronograma.xlsx",
          fileCount: 3,
          fileNames: ["cronograma.xlsx", "resultados.csv", "auditoria.ods"],
          status: "watching",
          lastSyncedAt: new Date("2026-08-13T18:30:00-03:00").getTime(),
        },
      }),
    );

    expect(html).toContain("Qualidade Suape");
    expect(html).toContain("3 planilhas compatíveis");
    expect(html).toContain("3 formatos");
    expect(html).toContain("cronograma.xlsx");
    expect(html).toContain("resultados.csv");
    expect(html).toContain("auditoria.ods");
    expect(html).toContain("Arquivo ativo");
    expect(html).not.toContain("Click to open");
  });

  it("explica os formatos aceitos quando nenhuma pasta está conectada", () => {
    const html = renderToStaticMarkup(createElement(FolderMonitorWidget, { monitor: undefined }));

    expect(html).toContain("Nenhuma pasta conectada");
    expect(html).toContain("Formatos reconhecidos");
    expect(html).toContain("Excel, OpenDocument, CSV, TSV, XML, HTML e Apple Numbers");
  });
});
