/**
 * Densidade de um widget: o quanto ele pode mostrar no espaço que ele tem.
 *
 * A diferença em relação aos pontos de quebra de tela é o que importa aqui.
 * Um widget de um terço em um monitor grande e um widget inteiro em um tablet
 * podem ter a mesma largura, e é a largura dele — não a da janela — que decide
 * se cabe rótulo em cima da barra, se o nome da categoria cabe escrito ou se a
 * barra de configuração precisa encolher.
 *
 * Os limites abaixo são a fonte única desses três modos, usada tanto pelas
 * regras de CSS (via container queries) quanto pelas decisões de conteúdo
 * feitas em JavaScript, para as duas não divergirem.
 */
export type WidgetDensity = "compact" | "normal" | "expanded";

/** Abaixo disso o widget é compacto; a partir de EXPANDED_MIN ele é expandido. */
export const WIDGET_DENSITY_COMPACT_MAX = 420;
export const WIDGET_DENSITY_EXPANDED_MIN = 720;

export function densityForWidth(width: number): WidgetDensity {
  if (!Number.isFinite(width) || width <= 0) return "normal";
  if (width < WIDGET_DENSITY_COMPACT_MAX) return "compact";
  if (width >= WIDGET_DENSITY_EXPANDED_MIN) return "expanded";
  return "normal";
}

export const widgetDensityLabels: Record<WidgetDensity, string> = {
  compact: "Compacto",
  normal: "Normal",
  expanded: "Expandido",
};
