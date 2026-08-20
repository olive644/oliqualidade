import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

  const scrollChart = (direction: -1 | 1) => {
    const el = chartScrollRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.75, 240),
      behavior: "smooth",
    });
  };

  const ChartScrollButtons = ({ label, compact = false }: { label: string; compact?: boolean }) => (
    <div
      className={cn("absolute z-10 flex gap-1", compact ? "right-1 top-1" : "right-5 top-5")}
      data-export-controls
      aria-label={`Navegação horizontal do ${label}`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "rounded-full bg-card/90 shadow-sm backdrop-blur pointer-coarse:size-12",
          compact ? "size-7" : "size-8",
        )}
        onClick={() => scrollChart(-1)}
        aria-label={`Rolar ${label} para a esquerda`}
        title="Rolar para a esquerda"
      >
        <ArrowLeft className={compact ? "size-3.5" : "size-4"} />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(
          "rounded-full bg-card/90 shadow-sm backdrop-blur pointer-coarse:size-12",
          compact ? "size-7" : "size-8",
        )}
        onClick={() => scrollChart(1)}
        aria-label={`Rolar ${label} para a direita`}
        title="Rolar para a direita"
      >
        <ArrowRight className={compact ? "size-3.5" : "size-4"} />
      </Button>
    </div>
  );

  return { chartScrollRef, handleChartScrollPointerDown, ChartScrollButtons };
}
