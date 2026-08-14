# oli-ooxml-core

Núcleo Rust isolado para inventariar workbooks OOXML sem participar ainda do
caminho produtivo do aplicativo.

Nesta fase, ele lê `workbook.xml`, relações e worksheets por eventos XML,
preserva a ordem e visibilidade das abas, identifica o sistema de datas 1900 ou
1904 e compara dimensões declaradas com as células realmente presentes. Antes
de ler qualquer parte, valida caminhos, criptografia, quantidade de entradas,
bytes descompactados e razão de compactação do ZIP.

O contrato de saída é a versão `1.0.0` definida em
`../../contracts/ooxml-inventory.schema.json`.

```bash
cargo test --locked --manifest-path rust/oli-ooxml-core/Cargo.toml
cargo run --locked --manifest-path rust/oli-ooxml-core/Cargo.toml -- arquivo.xlsx
```

Não há integração WASM nesta etapa. A promoção para o adaptador existente só
ocorrerá depois dos testes de paridade de células e recursos.
