/**
 * Modo de uso do painel.
 *
 * O produto tinha modo apresentação (tela cheia, alternando marcadores), mas
 * nada entre ele e a tela de trabalho: quem só queria ler o painel convivia o
 * tempo todo com alça de arrastar, botão de remover, barra de configuração e
 * as ações de montagem na barra superior. São controles que competem com a
 * leitura e que só interessam a quem está montando o painel.
 *
 * "reading" esconde essas ferramentas de edição; "editing" é a tela de sempre.
 * Nada muda no dado nem no cálculo — é a mesma análise, sem as ferramentas de
 * montagem por cima dela.
 */
export type ViewMode = "reading" | "editing";

export const VIEW_MODE_STORAGE_KEY = "oliam-view-mode";

export function parseViewMode(value: string | null): ViewMode {
  return value === "reading" ? "reading" : "editing";
}

export const viewModeLabels: Record<ViewMode, string> = {
  reading: "Leitura",
  editing: "Edição",
};
