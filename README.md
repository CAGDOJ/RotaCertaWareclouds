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

O GitHub Pages serve apenas a interface estática. O serviço de login roda no endereço HTTPS indicado acima; seu build e configuração são mantidos no projeto Sites.
