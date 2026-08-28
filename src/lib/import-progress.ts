import type { WorkbookReadProgress, WorkbookReadStage } from "@/lib/workbook-reader";

/**
 * Rótulo e fração da leitura de planilha, prontos para a tela.
 *
 * A fração vem em unidades abstratas de trabalho, não em abas: a etapa de
 * verificação percorre cada aba duas vezes (lendo o XML original e comparando
 * com o leitor principal), então um contador em abas mentiria ali. Percentual
 * é a única forma que continua correta nas duas etapas mensuráveis.
 *
 * `parsing` não tem fração de propósito. É uma chamada única ao leitor
 * principal, que não expõe progresso, e desenhar uma barra que anda sozinha ali
 * seria inventar informação.
 */
export type ImportProgressView = { label: string; detail: string | null; ratio: number | null };

export const IMPORT_STAGE_LABELS: Record<WorkbookReadStage, string> = {
  decoding: "Identificando formato e codificação…",
  streaming: "Lendo o arquivo em blocos…",
  parsing: "Lendo células, fórmulas e formatação…",
  verifying: "Conferindo valores com o XML original…",
  analyzing: "Analisando cabeçalhos e regiões de dados…",
  comparing: "Comparando os leitores disponíveis…",
  complete: "Finalizando a importação…",
};

export function describeImportProgress(
  progress: WorkbookReadProgress,
  sheetsFound: number,
): ImportProgressView {
  const label = IMPORT_STAGE_LABELS[progress.stage];
  // As abas encontradas até agora só entram durante a análise, que é a etapa
  // que as produz. Mostrar o número antes disso diria "0 abas" durante metade
  // da espera, o que soa a erro em vez de a trabalho em andamento.
  const found =
    progress.stage === "analyzing" && sheetsFound > 0
      ? `${sheetsFound} ${sheetsFound === 1 ? "aba encontrada" : "abas encontradas"}`
      : null;
  const { completed, total } = progress;
  if (completed === undefined || !total || total <= 0) return { label, detail: found, ratio: null };
  const ratio = Math.min(1, Math.max(0, completed / total));
  const percent = `${Math.round(ratio * 100)}%`;
  return { label, detail: found ? `${percent} · ${found}` : percent, ratio };
}
