# oli-ooxml-core

Núcleo Rust para inventariar workbooks OOXML e materializar o caminho produtivo
de XLSX quando a validação ponta a ponta confirma paridade integral.

Nesta fase, ele lê `workbook.xml`, relações e worksheets por eventos XML,
preserva a ordem e visibilidade das abas, identifica o sistema de datas 1900 ou
1904 e compara dimensões declaradas com as células realmente presentes. Antes
de ler qualquer parte, valida caminhos, criptografia, quantidade de entradas,
bytes descompactados e razão de compactação do ZIP.

O contrato de saída é a versão `3.0.0` definida em
`../../contracts/ooxml-inventory.schema.json`.

A versão 3 acrescenta datas seriais 1900/1904 normalizadas, inclusive a
compatibilidade explícita com o dia fictício 29/02/1900, formatos de data e
hora conhecidos, mesclagens, linhas ocultas e intervalos de colunas ocultas.
O formato original continua preservado e a exibição permanece conservadora
quando o código de formato não pertence ao subconjunto implementado.

```bash
cargo test --locked --manifest-path rust/oli-ooxml-core/Cargo.toml
cargo run --locked --manifest-path rust/oli-ooxml-core/Cargo.toml -- arquivo.xlsx
```

O crate também expõe `inventory_ooxml_json` para `wasm32-unknown-unknown`. O
pacote web versionado é reconstruído com `npm run wasm:build` e validado com
`npm run wasm:smoke`. No aplicativo ele roda dentro do worker e materializa XLSX
quando inventário, estruturas e saída final coincidem com o leitor TypeScript.
Qualquer diferença aciona o fallback validado; o modo `shadow` permanece como
rollback operacional.

A promoção independente por formato exige ao menos cinco fontes reais
sanitizadas e **únicas**. A identidade é um HMAC local que não revela nome,
caminho nem conteúdo; cópias idênticas são ignoradas e entradas sem identidade
não contam para o gate.
