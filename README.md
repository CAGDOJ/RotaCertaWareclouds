# Rota Certa — celular

Primeiro protótipo móvel para organizar entregas vistas na Wareclouds. A tela de origem continua responsável por confirmar cada entrega; este projeto importa endereços e monta uma sequência de visita.

## Fluxo no celular

1. Abra a Wareclouds e entre na sua conta normalmente.
2. Importe pelo favorito de captura ou cole o texto/CSV da lista.
3. Confira os endereços importados e corrija os que estiverem incompletos.
4. Defina a saída, marque a autorização de serviços de mapa e toque em **Otimizar**.
5. Siga a sequência e abra cada próxima parada no Maps. As marcações de concluída ficam somente nesta lista.

## Privacidade e limites

- O importador extrai endereço, município, bloco, CEP, comentário de referência e, quando visível, código do pedido. Não extrai nome, telefone ou documento do destinatário.
- A lista e o progresso ficam no `localStorage` do navegador do aparelho. Não há conta ou sincronização.
- Ao otimizar, os endereços vão ao Nominatim para geocodificação e as coordenadas vão ao OSRM para calcular distâncias e ordem. A caixa de autorização começa desmarcada.
- O Nominatim público limita o uso a no máximo uma requisição por segundo; o OSRM público é uma instância de demonstração. O serviço pode limitar ou interromper consultas. Para vários usuários ou uso comercial, configurar um fornecedor de mapas com contrato e capacidade apropriada.
- A distância e o tempo não incluem trânsito ou tempo de atendimento. A ordem é uma aproximação baseada nos tempos da matriz rodoviária.
- A captura via favorito executa o código na página já autenticada da Wareclouds. Ela só funciona depois que o favorito for configurado no Safari; o campo de texto/CSV é a alternativa.

## Publicar como site estático

Sirva `dist/` por HTTPS para que localização do celular e instalação na tela inicial funcionem. O manifesto e o service worker estão incluídos. A integração direta com a Wareclouds depende de uma API oficial ou de um importador executado pelo usuário na página já aberta.
