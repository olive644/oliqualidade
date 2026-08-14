# oli-ooxml-core

Núcleo Rust isolado para inventariar workbooks OOXML sem participar ainda do
caminho produtivo do aplicativo.

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
`npm run wasm:smoke`. No aplicativo ele roda em shadow mode dentro do worker:
mede a paridade com o leitor OOXML TypeScript, mas não monta, repara nem
substitui as planilhas entregues ao usuário.
