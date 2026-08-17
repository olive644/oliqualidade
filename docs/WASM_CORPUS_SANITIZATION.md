# Sanitiza&ccedil;&atilde;o local do corpus WASM

Este fluxo prepara c&oacute;pias de planilhas reais para a medi&ccedil;&atilde;o local de paridade
entre os leitores TypeScript e Rust/WASM. Nenhum arquivo &eacute; enviado para um
servi&ccedil;o externo. A origem, as c&oacute;pias sanitizadas e o manifesto local ficam fora
do Git por meio do `.gitignore`.

## Garantias e limites

O sanitizador aceita `.xlsx`, `.xlsm`, `.xltx` e `.xltm`. A origem nunca &eacute;
alterada e o destino precisa estar vazio.

Arquivos com macro (`.xlsm`/`.xltm`) s&atilde;o aceitos, mas o conte&uacute;do VBA em si
nunca chega a ser lido nem regravado: a leitura usa `bookVBA: false` (o
SheetJS nem decodifica o bin&aacute;rio da macro) e `workbook.vbaraw` &eacute; sempre
removido antes de gravar, independente do que a origem continha. A sa&iacute;da &eacute;
um arquivo macro-enabled v&aacute;lido (o Excel abre normalmente) s&oacute; que sem
nenhuma macro dentro &mdash; o Rust nunca executa VBA mesmo, ent&atilde;o o objetivo
aqui n&atilde;o &eacute; preservar a macro, &eacute; preservar a extens&atilde;o real do arquivo pra
o gate de promo&ccedil;&atilde;o contar a fonte no formato certo (`docs/WASM_PROMOTION_CRITERIA.md`).

A sa&iacute;da sanitizada de um `.xltx`/`.xltm` de origem preserva o formato de
modelo de verdade. O SheetJS instalado neste projeto s&oacute; sabe ESCREVER
`bookType` `xlsx`/`xlsm` (`XLSX.write` lan&ccedil;a `Unrecognized bookType |xltx|`
pra qualquer outro valor), mas a &uacute;nica diferen&ccedil;a OOXML real entre um
workbook "documento" e o "modelo" equivalente &eacute; a declara&ccedil;&atilde;o de
Content-Type da parte `/xl/workbook.xml` dentro do ZIP &mdash; todo o resto
(c&eacute;lulas, f&oacute;rmulas, estilos) &eacute; id&ecirc;ntico. O sanitizador grava com o
`bookType` que o SheetJS suporta e depois reabre s&oacute; o
`[Content_Types].xml` pra trocar essa &uacute;nica string, sem tocar em mais nada
do ZIP. O resultado &eacute; um `.xltx`/`.xltm` sanitizado que o Excel reconhece
como modelo de verdade, ent&atilde;o **conta como fonte real no gate de
promo&ccedil;&atilde;o do pr&oacute;prio formato** (`docs/WASM_PROMOTION_CRITERIA.md`), n&atilde;o
s&oacute; do gate `xlsx`/`xlsm`.

Em cada workbook, o processo:

- troca textos por pseud&ocirc;nimos HMAC determin&iacute;sticos;
- substitui n&uacute;meros e desloca datas sem mudar seus tipos;
- renomeia abas e ajusta refer&ecirc;ncias internas nas f&oacute;rmulas;
- pseudonimiza literais de texto dentro das f&oacute;rmulas;
- neutraliza f&oacute;rmulas com refer&ecirc;ncias externas;
- remove links, coment&aacute;rios, propriedades, nomes definidos e conte&uacute;do VBA
  (nunca lido, ver "Garantias e limites" acima);
- preserva f&oacute;rmulas internas, formatos de c&eacute;lula, mesclagens, linhas ocultas e
  colunas ocultas.

A igualdade entre pseud&ocirc;nimos ainda revela que duas c&eacute;lulas tinham o mesmo
texto. Isso &eacute; intencional para conservar padr&otilde;es &uacute;teis ao teste, mas significa
que o resultado deve continuar sendo tratado como um artefato local controlado.
Fa&ccedil;a uma revis&atilde;o humana antes de compartilhar qualquer c&oacute;pia sanitizada.

## Execu&ccedil;&atilde;o

No PowerShell, escolha uma chave longa e exclusiva para o corpus atual:

```powershell
$env:OLI_CORPUS_SANITIZE_SALT = "uma-chave-local-com-pelo-menos-16-caracteres"
npm run corpus:sanitize -- --input "C:\planilhas-originais" --output "test-fixtures\sanitized-real"
Remove-Item Env:OLI_CORPUS_SANITIZE_SALT
```

O destino recebe arquivos com nomes neutros e `manifest.local.json`. O
manifesto guarda somente identificadores HMAC, hashes das c&oacute;pias sanitizadas,
contagens e nomes neutros; ele n&atilde;o registra nomes nem caminhos de origem ou a
chave.

Depois, `npm run wasm:corpus` inclui automaticamente esse manifesto local no
relat&oacute;rio `test-results/wasm-corpus-report.json`. Sem o corpus local, a CI mede
somente as 25 fixtures sint&eacute;ticas e o gate permanece bloqueado.

Para manter o destino fora do reposit&oacute;rio, defina
`OLI_SANITIZED_CORPUS_DIR` com o caminho absoluto dessa pasta ao executar
`npm run wasm:corpus`.

Use uma pasta de destino nova para repetir o processo. O comando n&atilde;o apaga nem
sobrescreve arquivos existentes.
