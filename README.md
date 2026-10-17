# Rota Certa — entregas Wareclouds pelo celular

## Como usar

1. Abra o [Rota Certa](https://cagdoj.github.io/RotaCertaWareclouds/) e toque em **Importar**.
2. Entre com seu usuário e senha da Wareclouds e toque em **Entrar e importar**.
3. As entregas da aba **Entregar** são carregadas com endereço, município, CEP e complemento disponíveis.
4. Escolha a saída, autorize os serviços de mapa e toque em **Otimizar**.

A Wareclouds continua responsável por registrar as entregas. A lista por texto/CSV fica disponível como opção secundária.

## Conexão e privacidade

- O frontend é publicado no GitHub Pages. O serviço de importação roda em HTTPS em `https://rotacerta-mobile.carlosjralfa.chatgpt.site/api/wareclouds/import`.
- O servidor autentica normalmente na Wareclouds com HTTP Basic em `/login/clouder` e usa o token retornado somente para ler `/clouders/orders/in-route-to-consumer`. Não modifica pedidos.
- São utilizados os endpoints do cliente web público da Wareclouds. Essa integração independente depende da disponibilidade e do formato desses endpoints; mudanças na plataforma podem exigir atualização.
- Senha e tokens não são gravados nem retornados pelo serviço. O formulário apaga a senha ao terminar ou cancelar. O navegador pode oferecer seu próprio gerenciador de senhas.
- A resposta usa uma lista explícita de campos de rota; não inclui campos de nome, telefone, e-mail ou documento do destinatário.
- A lista e a rota ficam no armazenamento local do aparelho. Um erro de login ou uma resposta incompleta preserva a lista anterior. Uma importação bem-sucedida sem pedidos limpa a lista anterior para evitar usar entregas antigas.
- O serviço aceita requisições dos dois sites do Rota Certa, limita o tamanho do formulário e aplica uma proteção de tentativas por IP na memória do Worker. Essa proteção é por instância, sem garantia de limite global.
- Os endereços são enviados ao Nominatim e coordenadas ao OSRM ao otimizar. São serviços públicos com limites; distância e tempo são estimativas sem trânsito ou atendimento.

## Código e publicação

- `dist/`: aplicação móvel e assets estáticos usados tanto pelo GitHub Pages quanto pelo Site.
- `lib/wareclouds.mjs`: autenticação, leitura e seleção dos campos importados.
- `app/api/wareclouds/import/route.ts`: endpoint do Worker via Vinext.
- `.github/workflows/pages.yml`: publica `dist/` no GitHub Pages.
- `.openai/hosting.json`: identidade e configuração do Site que hospeda o Worker.

Instalação e build seguem os scripts fornecidos pelo Sites; não envie senhas em arquivos, variáveis globais de código ou URLs.

Verificações:

```sh
node tests/core.test.cjs
node tests/wareclouds.test.mjs
node tests/import-flow.test.cjs
npm run build
```

## Acompanhamento individual do cliente

Após otimizar a rota, toque em **Iniciar acompanhamento**, permita o GPS e compartilhe o link ao lado de cada pedido. A tela do cliente mostra mapa, status e previsão estimada. Enquanto houver outras entregas antes da sua, o cliente vê apenas seu próprio destino; a posição do entregador aparece somente quando ele é o próximo. Marcar a parada como concluída libera o acompanhamento para a seguinte.

Mantenha a página do motorista aberta e o celular com internet. Navegadores de celular podem suspender o GPS com a tela bloqueada ou em segundo plano. A posição é ocultada após 60 segundos sem uma leitura recente; não há garantia de rastreamento em segundo plano. A página do cliente consulta atualizações a cada 15 segundos e não envia mensagens automáticas pelo WhatsApp.

Os links expiram em 24 horas e podem ser encerrados pelo motorista. A previsão considera tempos estimados de direção e três minutos de atendimento entre paradas, sem trânsito ao vivo. Ao ativar, os dados mínimos dos pedidos e a última posição são mantidos no servidor; não é armazenado histórico de posições. Tokens de leitura e de atualização são distintos e somente seus hashes são guardados no banco. O cliente nunca recebe a lista de outros pedidos nem a rota completa. Links e a capacidade de controle do motorista ficam neste aparelho; não os publique.

- `dist/acompanhar.html` e `dist/customer-tracking.js`: tela do cliente; `?demo=1` exibe uma prévia explicitamente ilustrativa.
- `dist/driver-tracking.js`: controle do GPS e compartilhamento de links pelo motorista.
- `lib/tracking.mjs` e `app/api/tracking/route.ts`: API de acompanhamento.
- `db/schema.ts` e `drizzle/`: armazenamento D1 e migrações aplicadas na publicação do servidor.
- Testes: `node tests/tracking.test.mjs` e `node tests/driver-tracking.test.cjs`, além dos testes existentes.
