import { useEffect, useRef, useState } from "react";
import { densityForWidth } from "@/lib/widget-density";

/**
 * Mede a largura real de um elemento e devolve a densidade correspondente.
 *
 * Existe porque decisões de conteúdo — se o valor cabe escrito em cima da
 * barra, quantas letras do nome da categoria cabem — dependem do espaço que
 * aquele widget tem naquele painel, e não do tamanho da janela. Antes disso,
 * essas contas partiam de uma largura estimada pelo span do widget, que erra
 * em tela pequena e desperdiça espaço em tela grande.
 *
 * Enquanto a medida não chega (primeira renderização, servidor, navegador sem
 * ResizeObserver), a largura fica em 0 e quem consome cai na estimativa
 * anterior, em vez de esconder conteúdo sem motivo.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      // Ignora variação abaixo de um pixel: o observador dispara em cada
      // quadro de uma animação de layout, e re-renderizar o gráfico inteiro
      // a cada fração de pixel deixa a interface arrastada.
      setWidth((current) => (Math.abs(current - measured) < 1 ? current : measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width, density: densityForWidth(width) };
}
