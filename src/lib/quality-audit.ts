import type { Row } from "@/lib/types";

export type QualityConfidence = "verified" | "likely" | "assumed";

export type QualityDimension = {
  score: number;
  confidence: QualityConfidence;
  evidence: string;
};

export type AdaptedQualityAudit = {
  score: number;
  verdict: "production-ready" | "usable-with-caveats" | "remediation-required";
  dimensions: {
    completeness: QualityDimension;
    consistency: QualityDimension;
    validity: QualityDimension;
    uniqueness: QualityDimension;
    fidelity: QualityDimension;
  };
  intentionalBlankCells: number;
  unresolvedReaderDivergences: number;
};

const PERIOD = /^(?:(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-/ ]?\d{2,4}|\d{1,2}[-/]\d{2,4}|\d{4})$/i;
const EXCEL_ERROR = /^#(?:DIV\/0!|N\/A|REF!|VALUE!|NAME\?|NULL!|NUM!)$/i;

export function buildAdaptedQualityAudit(input: {
  rows: Row[];
  columnConsistency: Array<{ key: string; score: number }>;
  duplicateRows: number;
  interpretationScore: number;
  unresolvedReaderDivergences: number;
}): AdaptedQualityAudit {
  const keys = Object.keys(input.rows[0] ?? {});
  const periodKeys = new Set(keys.filter((key) => PERIOD.test(key.trim())));
  let expected = 0;
  let filled = 0;
  let intentionalBlankCells = 0;
  let invalid = 0;
  for (const row of input.rows) {
    for (const key of keys) {
      const value = row[key];
      const empty = value === null || value === "";
      if (periodKeys.has(key) && empty) {
        intentionalBlankCells++;
        continue;
      }
      expected++;
      if (!empty) filled++;
      if (typeof value === "string" && EXCEL_ERROR.test(value.trim())) invalid++;
    }
  }
  const completeness = expected ? Math.round((filled / expected) * 100) : 100;
  const consistency = input.columnConsistency.length
    ? Math.round(
        input.columnConsistency.reduce((sum, column) => sum + column.score, 0) /
          input.columnConsistency.length,
      )
    : 100;
  const validity = Math.round((1 - invalid / Math.max(1, filled)) * 100);
  const uniqueness = Math.round(
    (1 - input.duplicateRows / Math.max(1, input.rows.length)) * 100,
  );
  const fidelity = Math.max(
    0,
    Math.round(input.interpretationScore - input.unresolvedReaderDivergences * 2),
  );
  const score = Math.round(
    completeness * 0.2 + consistency * 0.25 + validity * 0.2 + uniqueness * 0.1 + fidelity * 0.25,
  );
  return {
    score,
    verdict:
      score >= 85
        ? "production-ready"
        : score >= 65
          ? "usable-with-caveats"
          : "remediation-required",
    dimensions: {
      completeness: {
        score: completeness,
        confidence: "verified",
        evidence: `${filled}/${expected} células obrigatórias preenchidas; vazios futuros do cronograma não foram penalizados`,
      },
      consistency: {
        score: consistency,
        confidence: "likely",
        evidence: "conformidade das representações observadas por coluna",
      },
      validity: {
        score: validity,
        confidence: "verified",
        evidence: `${invalid} erro(s) explícito(s) do Excel`,
      },
      uniqueness: {
        score: uniqueness,
        confidence: "likely",
        evidence: `${input.duplicateRows} linha(s) integralmente duplicada(s); chave de negócio não presumida`,
      },
      fidelity: {
        score: fidelity,
        confidence: "verified",
        evidence: `${input.unresolvedReaderDivergences} divergência(s) não resolvida(s) entre leitores`,
      },
    },
    intentionalBlankCells,
    unresolvedReaderDivergences: input.unresolvedReaderDivergences,
  };
}
