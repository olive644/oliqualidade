import { useCallback, useEffect, useRef, useState } from "react";

/** Quanto o ponteiro precisa sossegar antes de a leitura acompanhar. */
const ESPERA_MS = 90;

/**
 * O índice sob o ponteiro, atualizado só quando ele sossega.
 *
 * O estado de hover de um gráfico alimenta duas coisas: o destaque da forma e o
 * painel de leitura embaixo. Atualizá-lo a cada barra que o ponteiro atravessa
 * reconstrói o widget inteiro — eixos, grade, todas as formas, legenda e painel
 * — só para trocar qual delas está destacada.
 *
 * Medido, passeando o mouse sobre um gráfico de 25 barras **sem rolar nada**:
 *
 * | Cenário | Tarefas longas | Tempo bloqueado |
 * | --- | ---: | ---: |
 * | Como estava | 14 | 2.883 ms |
 * | Sem hover nenhum (teto do ganho) | 2 | 504 ms |
 *
 * Ou seja, o hover respondia por 83% do custo. O perfil de CPU mostrou onde:
 * `React.createElement` com 743 ms e `jsxDEV` com 335, que é a árvore inteira
 * do gráfico sendo recriada a cada movimento.
 *
 * A espera resolve porque atravessar não é inspecionar. Quem arrasta o ponteiro
 * de um lado ao outro do gráfico não está lendo cada barra do caminho; quem
 * quer ler para. Noventa milissegundos é curto o bastante para a leitura
 * parecer imediata, e longo o bastante para engolir a travessia.
 *
 * A saída de hover não espera: tirar o ponteiro do gráfico apaga o destaque na
 * hora, porque atraso ali apareceria como destaque preso.
 */
export function useHoverIndex(): [number | null, (index: number | null) => void] {
  const [indice, setIndice] = useState<number | null>(null);
  const pendente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (pendente.current) clearTimeout(pendente.current);
    },
    [],
  );

  const definir = useCallback((proximo: number | null) => {
    if (pendente.current) clearTimeout(pendente.current);
    if (proximo === null) {
      setIndice(null);
      return;
    }
    pendente.current = setTimeout(() => setIndice(proximo), ESPERA_MS);
  }, []);

  return [indice, definir];
}
