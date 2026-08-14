# Critérios de promoção do núcleo Rust/WASM

O núcleo Rust permanece em **shadow mode**. Ele mede o mesmo arquivo depois do
leitor produtivo, mas seu inventário não cria, substitui nem repara dados da
importação. A promoção só pode ser discutida quando o gate automatizado estiver
aprovado para um formato específico.

## Amostragem

`VITE_WASM_SHADOW_SAMPLE_RATE` controla a parcela de arquivos OOXML medida, de
`0` a `1`. O padrão é `1`. A seleção usa uma assinatura determinística e efêmera
do nome, tamanho e extremidades do arquivo; nenhum desses dados é persistido pelo
motor. Arquivos não selecionados recebem o estado `sampled-out`.

## Gate padrão

O avaliador `assessWasmPromotion` exige simultaneamente:

- contrato de inventário `3.0.0` em todas as medições;
- pelo menos 25 arquivos efetivamente medidos;
- pelo menos 10.000 células comparadas;
- zero falhas do adaptador;
- zero arquivos, abas ou células divergentes;
- latência p95 do shadow mode de até 1.500 ms.

Estados `unavailable` e `sampled-out` não contam como arquivos medidos. O gate
retorna todos os motivos de bloqueio, em vez de apenas o primeiro.

## Corpus e decisão

O comando `npm run wasm:corpus` executa o binário WebAssembly versionado contra
a fixture pública, compara valores brutos, textos exibidos e fórmulas com o
inventário OOXML TypeScript e imprime a métrica observada. Esse teste também
confirma que uma fixture isolada é insuficiente para promoção.

Arquivos reais adicionais podem continuar no corpus local sanitizado. A
promoção futura deverá ser separada por formato e acompanhada de revisão humana
das divergências aceitas. Alterar os limites ou permitir que o Rust influencie o
resultado produtivo exige uma mudança explícita e revisável; atingir o gate, por
si só, não ativa o leitor.
