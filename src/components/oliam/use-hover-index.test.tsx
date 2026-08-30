import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWidget } from "@/test/render-widget";
import { useHoverIndex } from "./use-hover-index";

function HoverProbe() {
  const [index, setIndex] = useHoverIndex();
  return (
    <>
      <button onMouseEnter={() => setIndex(0)} onMouseLeave={() => setIndex(null)}>
        primeira
      </button>
      <button onMouseEnter={() => setIndex(1)} onMouseLeave={() => setIndex(null)}>
        segunda
      </button>
      <output data-testid="indice-ativo">{index ?? "nenhuma"}</output>
    </>
  );
}

describe("useHoverIndex", () => {
  it("mantém o destaque anterior ao atravessar para a barra vizinha", () => {
    vi.useFakeTimers();
    try {
      renderWidget(<HoverProbe />);
      const primeira = screen.getByRole("button", { name: "primeira" });
      const segunda = screen.getByRole("button", { name: "segunda" });

      fireEvent.mouseEnter(primeira);
      act(() => vi.advanceTimersByTime(90));
      expect(screen.getByTestId("indice-ativo").textContent).toBe("0");

      fireEvent.mouseLeave(primeira);
      fireEvent.mouseEnter(segunda);

      // Não existe o quadro intermediário "nenhuma barra destacada", que
      // fazia a opacidade do gráfico inteiro piscar durante a travessia.
      expect(screen.getByTestId("indice-ativo").textContent).toBe("0");

      act(() => vi.advanceTimersByTime(90));
      expect(screen.getByTestId("indice-ativo").textContent).toBe("1");

      fireEvent.mouseLeave(segunda);
      expect(screen.getByTestId("indice-ativo").textContent).toBe("1");
      act(() => vi.advanceTimersByTime(90));
      expect(screen.getByTestId("indice-ativo").textContent).toBe("nenhuma");
    } finally {
      vi.useRealTimers();
    }
  });
});
