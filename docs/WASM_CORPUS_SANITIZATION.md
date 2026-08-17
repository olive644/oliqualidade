# Sanitiza&ccedil;&atilde;o local do corpus WASM

Este fluxo prepara c&oacute;pias de planilhas reais para a medi&ccedil;&atilde;o local de paridade
entre os leitores TypeScript e Rust/WASM. Nenhum arquivo &eacute; enviado para um
servi&ccedil;o externo. A origem, as c&oacute;pias sanitizadas e o manifesto local ficam fora
do Git por meio do `.gitignore`.

## Garantias e limites

O sanitizador aceita `.xlsx` e `.xltx`. Arquivos com macros (`.xlsm` ou `.xltm`)
fazem a execu&ccedil;&atilde;o falhar antes de qualquer sa&iacute;da ser criada. A origem nunca &eacute;
alterada e o destino precisa estar vazio.

A sa&iacute;da sanitizada de um `.xltx` de origem sempre grava um `.xlsx` de
verdade &mdash; o SheetJS instalado neste projeto s&oacute; sabe escrever
`bookType` `xlsx`/`xlsm` (`XLSX.write` lan&ccedil;a `Unrecognized bookType |xltx|`
pra qualquer outro valor), ent&atilde;o o Content-Types interno nunca declara
"template". Isso preserva fielmente o conte&uacute;do real pra teste de paridade
TS&times;Rust, mas esse `.xlsx` sanitizado **n&atilde;o conta como fonte `.xltx`** no
gate de promo&ccedil;&atilde;o (ver `docs/WASM_PROMOTION_CRITERIA.md`).

Em cada workbook, o processo:

- troca textos por pseud&ocirc;nimos HMAC determin&iacute;sticos;
- substitui n&uacute;meros e desloca datas sem mudar seus tipos;
- renomeia abas e ajusta refer&ecirc;ncias internas nas f&oacute;rmulas;
- pseudonimiza literais de texto dentro das f&oacute;rmulas;
- neutraliza f&oacute;rmulas com refer&ecirc;ncias externas;
- remove links, coment&aacute;rios, propriedades, nomes definidos e conte&uacute;do VBA;
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
