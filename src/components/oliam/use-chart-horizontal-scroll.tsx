import { useCallback, useMemo, useRef, type RefObject } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Os botões de rolagem, num componente de módulo e não dentro do hook.
 *
 * Isto não é organização: é correção de defeito. Definido dentro do hook, o
 * componente era uma **função nova a cada renderização**, e o React trata
 * função nova como tipo novo — desmonta a subárvore inteira e monta outra no
 * lugar. Como os botões ficam sobrepostos ao gráfico, cada renderização os
 * fazia piscar, e passar o mouse pelo card renderiza várias vezes por segundo.
 *
 * Medido antes do conserto, com uma sonda que marca o elemento e observa a
 * marca quadro a quadro: os botões assumiram **22 identidades diferentes** numa
 * passagem de mouse, enquanto o `svg` e o `wrapper` do gráfico mantiveram uma
 * só. Ou seja, não era o gráfico que remontava, era o que está por cima dele.
 */
function ChartScrollButtonsBase({
  label,
  compact = false,
  onScroll,
}: {
  label: string;
  compact?: boolean;
  onScroll: (direction: -1 | 1) => void;
}) {
  const botao = cn(
    "rounded-full bg-card/90 shadow-sm backdrop-blur pointer-coarse:size-12",
    compact ? "size-7" : "size-8",
  );
  return (
    <div
      className={cn("absolute z-10 flex gap-1", compact ? "right-1 top-1" : "right-5 top-5")}
      data-export-controls
      aria-label={`Navegação horizontal do ${label}`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={botao}
        onClick={() => onScroll(-1)}
        aria-label={`Rolar ${label} para a esquerda`}
        title="Rolar para a esquerda"
      >
        <ArrowLeft className={compact ? "size-3.5" : "size-4"} />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={botao}
        onClick={() => onScroll(1)}
        aria-label={`Rolar ${label} para a direita`}
        title="Rolar para a direita"
      >
        <ArrowRight className={compact ? "size-3.5" : "size-4"} />
      </Button>
    </div>
  );
}

/**
 * Gráfico com muitas categorias: permite arrastar com o mouse pra rolar na
 * horizontal (touch já rola nativamente via overflow-x-auto, isso só cobre
 * o caso de clicar-e-arrastar com o mouse). Usado por metric-trend (sparkline)
 * e bar/pie/line/area.
 */
export function useChartHorizontalScroll() {
  const chartScrollRef = useRef<HTMLDivElement>(null);

  const handleChartScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = chartScrollRef.current;
    if (!el) return;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let dragged = false;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (!dragged && Math.abs(delta) > 3) {
        dragged = true;
        // Só captura o ponteiro quando o gesto vira arrasto de verdade. Fazer
        // isso incondicionalmente no pointerdown (como antes) redireciona o
        // alvo de todo evento de ponteiro/clique seguinte para `el`, mesmo
        // sem nenhum arrasto real — um clique parado nunca chegava a disparar
        // o onClick da barra por baixo do cursor, porque o clique "pousava"
        // no container em vez da barra. Bug real, não só o caso de suprimir
        // clique-após-arrasto que o código já tratava abaixo.
        el.setPointerCapture(pointerId);
        el.classList.add("oliam-chart-dragging");
      }
      if (dragged) el.scrollLeft = startScroll - delta;
    };
    const onUp = () => {
      el.classList.remove("oliam-chart-dragging");
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      // Evita que o clique-arrasto dispare o cross-filter da barra por baixo
      // do cursor (onClick da <Bar>) quando o usuário só quis rolar.
      if (dragged) {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
        const suppress = (evt: MouseEvent) => evt.stopPropagation();
        el.addEventListener("click", suppress, { capture: true, once: true });
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const scrollChart = useCallback((direction: -1 | 1) => {
    const el = chartScrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.75, 240),
      behavior: "smooth",
    });
  }, []);

  // O elemento devolvido é uma referência ao **mesmo** componente de módulo, com
  // as props presas. Quem chama continua escrevendo `<ChartScrollButtons ... />`
  // e o React reconhece o tipo entre renderizações, em vez de remontar.
  const ChartScrollButtons = useMemo(
    () =>
      function ChartScrollButtons(props: { label: string; compact?: boolean }) {
        return <ChartScrollButtonsBase {...props} onScroll={scrollChart} />;
      },
    [scrollChart],
  );

  return { chartScrollRef, handleChartScrollPointerDown, ChartScrollButtons };
}

export type ChartScrollRef = RefObject<HTMLDivElement | null>;
