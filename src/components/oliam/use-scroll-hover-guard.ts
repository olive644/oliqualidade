import { useEffect } from "react";

/** Quanto tempo depois do último evento de rolagem o hover volta a valer. */
const REPOUSO_MS = 150;

/**
 * Desliga o hover dos widgets enquanto a página está rolando.
 *
 * O problema que isto resolve foi medido, e é grande. Ao rolar, o ponteiro fica
 * **parado** e são os widgets que passam por baixo dele. Cada barra, fatia e
 * ponto que cruza o cursor dispara `mouseenter` e `mouseleave`, cada um muda
 * estado no React, cada mudança re-renderiza o widget inteiro, e o Recharts
 * troca os elementos do desenho. O resultado é a thread principal saturada
 * justamente durante a rolagem, com quadros perdidos e o desenho aparecendo
 * rasgado.
 *
 * Medido num painel de sete gráficos, rolando o mesmo tanto:
 *
 * | Ponteiro | Tarefas longas | Soma | Mutações de DOM |
 * | --- | ---: | ---: | ---: |
 * | Sobre o painel | 8 | 3.064 ms | 357 |
 * | Fora do painel | 0 | 0 ms | 0 |
 *
 * A diferença é inteira, e não uma questão de grau: com o ponteiro fora, rolar
 * não custa **nada**.
 *
 * O desligamento é por `pointer-events`, e não por uma trava dentro de cada
 * manipulador. A razão é que boa parte do trabalho não é nossa: o Recharts tem
 * o próprio rastreamento de mouse para tooltip e ponto ativo, e uma trava nos
 * nossos manipuladores não o alcançaria. Cortar o evento na origem alcança os
 * dois.
 *
 * A classe é posta direto no DOM, sem estado do React, porque o ouvinte roda a
 * cada quadro de rolagem e re-renderizar por causa dele trocaria um problema
 * pelo mesmo problema.
 */
export function useScrollHoverGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let repouso: ReturnType<typeof setTimeout> | undefined;
    const aoRolar = () => {
      document.body.classList.add("oliam-rolando");
      if (repouso) clearTimeout(repouso);
      repouso = setTimeout(() => document.body.classList.remove("oliam-rolando"), REPOUSO_MS);
    };
    // Captura, porque `scroll` não borbulha: sem isto, a rolagem que acontece
    // dentro do painel nunca chegaria a um ouvinte na janela.
    window.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    // `wheel` também, e isto foi medido: armar só no `scroll` deixa uma janela
    // aberta no começo de cada gesto, porque o `scroll` chega **depois** de o
    // navegador já ter reposicionado o conteúdo e refeito o teste de acerto sob
    // o ponteiro. A amostragem quadro a quadro mostrava a guarda alternando
    // entre ligada e desligada durante a mesma rolagem.
    window.addEventListener("wheel", aoRolar, { capture: true, passive: true });
    window.addEventListener("touchmove", aoRolar, { capture: true, passive: true });
    return () => {
      window.removeEventListener("scroll", aoRolar, { capture: true });
      window.removeEventListener("wheel", aoRolar, { capture: true });
      window.removeEventListener("touchmove", aoRolar, { capture: true });
      if (repouso) clearTimeout(repouso);
      document.body.classList.remove("oliam-rolando");
    };
  }, []);
}
