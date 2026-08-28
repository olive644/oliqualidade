import { describe, expect, it } from "vitest";
import {
  chooseImportStrategy,
  estimateCurrentPathPeakBytes,
  IMPORT_COMFORTABLE_PEAK_BYTES,
  IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED,
  IMPORT_PEAK_MEMORY_RATIO,
  isConstrainedDevice,
} from "@/lib/import-strategy";

/** Tamanho de arquivo cujo pico previsto bate exatamente no teto informado. */
const bytesNoLimite = (teto: number) => teto / IMPORT_PEAK_MEMORY_RATIO;

const tudoDisponivel = { csv: true, ooxml: true };

describe("escolha do caminho de importação", () => {
  it("prevê o pico a partir da razão medida no baseline", () => {
    // Não é chute de projeto: é a razão observada nos quatro cenários medidos.
    expect(estimateCurrentPathPeakBytes(10 * 1024 * 1024)).toBe(
      10 * 1024 * 1024 * IMPORT_PEAK_MEMORY_RATIO,
    );
    expect(estimateCurrentPathPeakBytes(0)).toBe(0);
    expect(estimateCurrentPathPeakBytes(-5)).toBe(0);
  });

  it("fica no caminho atual exatamente no limite", () => {
    const decisao = chooseImportStrategy({
      fileName: "vendas.xlsx",
      bytes: bytesNoLimite(IMPORT_COMFORTABLE_PEAK_BYTES),
      support: tudoDisponivel,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.reason).toBe("pico-confortavel");
    expect(decisao.estimatedPeakBytes).toBe(IMPORT_COMFORTABLE_PEAK_BYTES);
  });

  it("fica no caminho atual um byte abaixo do limite", () => {
    const decisao = chooseImportStrategy({
      fileName: "vendas.xlsx",
      bytes: bytesNoLimite(IMPORT_COMFORTABLE_PEAK_BYTES) - 1,
      support: tudoDisponivel,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.reason).toBe("pico-confortavel");
  });

  it("troca de caminho um byte acima do limite", () => {
    const decisao = chooseImportStrategy({
      fileName: "vendas.xlsx",
      bytes: bytesNoLimite(IMPORT_COMFORTABLE_PEAK_BYTES) + 1,
      support: tudoDisponivel,
    });

    expect(decisao.strategy).toBe("ooxml-progressivo");
    expect(decisao.reason).toBe("pico-alto");
  });

  it("usa um teto muito menor em aparelho modesto", () => {
    const bytes = bytesNoLimite(IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED) + 1;

    // O mesmo arquivo que ainda seria confortável num computador já justifica a
    // troca no celular, porque a aba morre bem antes de meio giga.
    expect(
      chooseImportStrategy({ fileName: "a.csv", bytes, support: tudoDisponivel }).strategy,
    ).toBe("atual");
    const noCelular = chooseImportStrategy({
      fileName: "a.csv",
      bytes,
      constrained: true,
      support: tudoDisponivel,
    });
    expect(noCelular.strategy).toBe("csv-progressivo");
    expect(noCelular.reason).toBe("pico-alto-em-aparelho-modesto");
    expect(noCelular.comfortablePeakBytes).toBe(IMPORT_COMFORTABLE_PEAK_BYTES_CONSTRAINED);
  });

  it("mantém o caminho atual em formato sem alternativa progressiva", () => {
    const decisao = chooseImportStrategy({
      fileName: "planilha.ods",
      bytes: 500 * 1024 * 1024,
      support: tudoDisponivel,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.preferred).toBe("atual");
    expect(decisao.reason).toBe("formato-sem-caminho-progressivo");
  });

  it("cai com segurança no caminho atual enquanto o progressivo não existe", () => {
    // Este é o estado desta PR: o seletor já decide, as implementações ainda
    // não existem, e nada muda para quem importa hoje.
    const decisao = chooseImportStrategy({
      fileName: "vendas.xlsx",
      bytes: 400 * 1024 * 1024,
    });

    expect(decisao.strategy).toBe("atual");
    expect(decisao.preferred).toBe("ooxml-progressivo");
    expect(decisao.reason).toBe("caminho-progressivo-indisponivel");
  });

  it("liga uma família de cada vez, sem afetar a outra", () => {
    const csv = chooseImportStrategy({
      fileName: "grande.csv",
      bytes: 400 * 1024 * 1024,
      support: { csv: true },
    });
    const ooxml = chooseImportStrategy({
      fileName: "grande.xlsx",
      bytes: 400 * 1024 * 1024,
      support: { csv: true },
    });

    expect(csv.strategy).toBe("csv-progressivo");
    expect(ooxml.strategy).toBe("atual");
    expect(ooxml.preferred).toBe("ooxml-progressivo");
  });

  it("reconhece as quatro extensões OOXML e as de texto", () => {
    const grande = 400 * 1024 * 1024;
    for (const nome of ["a.xlsx", "a.xlsm", "a.xltx", "a.xltm", "A.XLSX"])
      expect(
        chooseImportStrategy({ fileName: nome, bytes: grande, support: tudoDisponivel }).strategy,
        nome,
      ).toBe("ooxml-progressivo");
    for (const nome of ["a.csv", "a.txt", "a.tsv", "A.CSV"])
      expect(
        chooseImportStrategy({ fileName: nome, bytes: grande, support: tudoDisponivel }).strategy,
        nome,
      ).toBe("csv-progressivo");
  });
});

describe("sinal de aparelho modesto", () => {
  it("não depende de uma API só", () => {
    // deviceMemory não existe no Safari nem no Firefox. Tratar a ausência como
    // "máquina folgada" classificaria todo iPhone errado, que é o erro caro.
    expect(isConstrainedDevice({ deviceMemory: 4 })).toBe(true);
    expect(isConstrainedDevice({ hardwareConcurrency: 4 })).toBe(true);
    expect(isConstrainedDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" })).toBe(
      true,
    );
  });

  it("não marca como modesta uma máquina folgada", () => {
    expect(
      isConstrainedDevice({
        deviceMemory: 16,
        hardwareConcurrency: 12,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    ).toBe(false);
  });

  it("sem sinal nenhum, não assume aparelho modesto", () => {
    // Sem informação, o caminho atual continua valendo: ele é o validado.
    expect(isConstrainedDevice()).toBe(false);
  });
});
