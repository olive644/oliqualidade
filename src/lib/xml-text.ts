/**
 * Extrai texto de um fragmento XML do pacote OOXML.
 *
 * O que esta função faz é **decodificar**, não sanitizar, e a diferença
 * importa. O texto de uma célula que contém literalmente `<b>` chega ao
 * arquivo escapado como `&lt;b&gt;`; devolver `<b>` é a leitura correta, não
 * uma falha. Por isso a ordem é: remover a marcação XML primeiro, decodificar
 * as entidades depois — o contrário apagaria como marcação justamente o texto
 * que o usuário escreveu.
 *
 * A consequência é que a saída pode conter `<`, `>` e até a sequência
 * `<script>`, como texto. Isso é seguro enquanto o resultado for tratado como
 * texto, que é o caso hoje: o projeto não tem nenhum `dangerouslySetInnerHTML`
 * nem atribuição a `innerHTML`, e o React escapa tudo que renderiza.
 *
 * **Contrato**: o retorno é texto puro. Se algum dia ele for inserido como
 * HTML, a escapada tem que acontecer lá, e não aqui — trocar a ordem daqui
 * corromperia a leitura de planilha para resolver um problema que é do outro
 * lado.
 */
const XML_TAG = /<[^>]+>/g;

export function stripXmlMarkup(value: string): string {
  // Repetição até estabilizar em vez de uma passada só: com marcação
  // malformada, uma remoção pode juntar dois pedaços e formar uma tag nova
  // que a primeira passada não via. Em arquivo bem formado a segunda volta
  // não muda nada, então o custo é uma comparação de string.
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(XML_TAG, "");
  } while (current !== previous);
  return current;
}
