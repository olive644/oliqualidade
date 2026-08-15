# Critérios de promoção do núcleo Rust/WASM

O núcleo Rust/WASM é o candidato padrão para **XLSX**. Ele materializa a
planilha a partir do próprio inventário e só assume a saída quando ela é
idêntica, ponta a ponta, à importação validada pelo leitor TypeScript. Contrato
incompatível, divergência ou falha acionam fallback automático.

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
- pelo menos 5 arquivos reais sanitizados por formato;
- zero falhas do adaptador;
- zero arquivos, abas, células ou estruturas divergentes;
- latência p95 do shadow mode de até 1.500 ms.

Estados `unavailable` e `sampled-out` não contam como arquivos medidos. O gate
retorna todos os motivos de bloqueio, em vez de apenas o primeiro.

## Corpus e decisão

O comando `npm run wasm:corpus` gera 25 planilhas determinísticas a partir de
`test-fixtures/wasm-corpus-manifest.json`, executa o binário WebAssembly
versionado e compara valores brutos, textos exibidos, fórmulas, mesclagens,
linhas ocultas e colunas ocultas com o inventário OOXML TypeScript. O relatório
JSON completo é salvo em `test-results/wasm-corpus-report.json` e publicado como
artefato da CI.

O corpus sintético cobre volume e recursos, mas não pode aprovar sozinho a
promoção. O campo `source` distingue `synthetic` de `sanitized-real`, e o gate
permanece bloqueado enquanto não houver cinco arquivos reais sanitizados para o
formato avaliado.

## Ativação e rollback

O caminho candidato está habilitado por padrão e, nesta fase, aceita somente
`xlsx`:

```dotenv
VITE_WASM_READER_MODE=candidate
VITE_WASM_CANDIDATE_FORMATS=xlsx
```

Sem variáveis, esses mesmos valores são assumidos. O rollback operacional é
imediato com `VITE_WASM_READER_MODE=shadow`. O modo candidato verifica 100% dos
XLSX e registra `rust-wasm` somente quando o inventário Rust e a saída final são
equivalentes. Metadados complementares já validados, como filtros, tabelas,
comentários clássicos e links, são reconstruídos diretamente das partes OOXML
no workbook materializado. Eles não são mais copiados do workbook SheetJS.

O procedimento local, suas garantias e seus limites estão em
`docs/WASM_CORPUS_SANITIZATION.md`. O comando `npm run corpus:sanitize` cria
cópias XLSX com nomes neutros em uma pasta ignorada pelo Git. Quando o destino é
`test-fixtures/sanitized-real`, `npm run wasm:corpus` incorpora automaticamente
essas medições ao relatório sem alterar o corpus público da CI.

Arquivos reais adicionais podem continuar no corpus local sanitizado. Esse
corpus ainda é obrigatório antes de remover a validação dupla e promover o Rust
para um caminho independente. Até lá, o leitor TypeScript permanece como oráculo
e fallback, priorizando fidelidade sobre ganho de desempenho.

## Outros formatos OOXML (Etapa 4)

O adaptador Rust já é acionado em shadow mode para XLSM, XLTX e XLTM, não só
XLSX (`shouldTryWasm` em `workbook-reading-engine.ts` aceita as quatro
extensões, porque todas compartilham a mesma estrutura ZIP/OOXML que o
inventário Rust já lê). Antes desta etapa, porém, o corpus determinístico
(`test-fixtures/wasm-corpus-manifest.json`) só continha perfis `xlsx` — os
outros três formatos nunca tinham sido medidos de propósito.

- **XLSM**: `scripts/generate-workbook-corpus.mjs` grava esse formato sem
  mudança nenhuma no script (SheetJS suporta `bookType: "xlsm"` no
  `XLSX.write`). Quatro perfis foram adicionados (`baseline-xlsm`,
  `formulas-xlsm`, `structure-xlsm`, `date-system-1904-xlsm`), no mesmo
  padrão de diversidade já usado para XLSX — 25 arquivos, mais de 10.000
  células.
- **XLTX e XLTM**: **não foi possível gerar sinteticamente.** O SheetJS
  instalado neste projeto só implementa `bookType` `"xlsx"`/`"xlsm"` no
  caminho de escrita (`XLSX.write`); tentar `"xltx"` lança
  `Error: Unrecognized bookType |xltx|`. Sem um gerador, esses dois formatos
  continuam sem nenhuma medição de corpus — nem sintética nem real. Avaliar
  a promoção deles exigiria arquivos `.xltx`/`.xltm` reais de origem (a
  mesma trilha de "arquivo real indisponível" que já bloqueia a promoção
  final do XLSX).

Medição de referência do corpus XLSM expandido (25 arquivos, ≥10.000
células): **1 arquivo divergente em 12 células**, sempre a mesma causa —
números em formato "General" com muitas casas decimais (ex.:
`111.03999999999999`) são exibidos pelo Rust como o valor bruto
(`display_cell_value` só arredonda os formatos explícitos `0`/`0.00`/`0%`/
`0.00%`; fora deles cai em `value.to_string()`), enquanto o SheetJS
arredonda para exibição como o Excel faz (`111.04`). O valor bruto
(`rawValue`) é idêntico nos dois leitores; só a representação exibida
diverge. Essa é a lacuna já registrada na seção 12 de
`docs/CURRENT_STATE_AUDIT.md` ("exibição conservadora... sem inventar a
renderização de formatos Excel ainda não implementados") — o corpus
original de XLSX não a expunha porque suas sementes fixas não geravam esse
padrão de ponto flutuante, não porque XLSX seja imune a ela. Em produção
isso não corrompe nenhum dado: candidate mode trata qualquer divergência de
shadow (`wasmShadowStatus === "diverged"`) como motivo de fallback
automático para o leitor validado, antes mesmo de tentar materializar a
saída — exatamente o comportamento que essa medição comprova funcionando.

**Estado por formato após esta etapa**: XLSM tem corpus sintético
comparável em volume ao XLSX (25 arquivos, ≥10.000 células) e uma
divergência real e explicada, mas segue tão bloqueado para promoção quanto
antes — falta o mesmo corpus real sanitizado exigido para XLSX (5 arquivos
por formato) e a taxa de divergência atual não fecha o gate de qualquer
forma. XLTX e XLTM seguem sem nenhuma medição. Nenhum dos três teve a
allowlist de candidato (`VITE_WASM_CANDIDATE_FORMATS`) alterada; XLSX
continua sendo o único formato liberado para materializar saída Rust.
