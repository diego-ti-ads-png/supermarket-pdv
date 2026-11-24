# Supermarket PDV

Sistema inicial de ponto de venda para varejo/atacado com Node.js, Express, Supabase PostgreSQL e frontend HTML/CSS/JavaScript puro.

## Funcionalidades incluídas

- Login e cadastro por e-mail com Supabase Auth.
- Regras de senha: 12 caracteres, maiúscula, minúscula e caractere especial.
- Perfis Diretor, Gerente, Estoquista, Vendedor e Administrativo.
- Autorização validada no backend em cada rota protegida.
- Cadastro/listagem de produtos, cálculo de markup e alerta de estoque crítico (<= 3).
- Venda com baixa de estoque transacional via função PostgreSQL `create_sale`.
- Lançamentos financeiros de entrada e saída.
- Interface responsiva e logotipo SVG.

## Estrutura

```text
supermarket-pdv/
├── api/index.js          # API Express (Vercel serverless)
├── public/               # Frontend estático
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── supabase/schema.sql   # Tabelas, RLS e RPC transacional
├── tests/rules.test.js
├── .env.example
├── .gitignore
├── package.json
├── server.js             # Servidor local
└── vercel.json
```

## 1. Criar o projeto Supabase

1. Acesse https://supabase.com e crie um projeto.
2. Abra **SQL Editor > New query**.
3. Cole todo o conteúdo de `supabase/schema.sql` e execute.
4. Em **Project Settings > API**, copie Project URL e `service_role` key.
5. Em **Authentication > Providers > Email**, mantenha Email habilitado.
6. Em **Authentication > URL Configuration**, configure a URL do site e os redirects de confirmação para seu domínio local e domínio Vercel.
7. Em **Authentication > Settings**, configure a confirmação de e-mail conforme a política da loja.

A aplicação usa a chave `service_role` somente no backend. Nunca a coloque em arquivos `public/`, `app.js`, HTML ou variáveis `VITE_`.

## 2. Criar o primeiro Diretor

Por segurança, cadastros públicos sempre recebem o perfil `Vendedor`. Depois de cadastrar a conta inicial, promova-a uma única vez pelo SQL Editor, substituindo o e-mail:

```sql
update public.profiles
set role = 'Diretor'
where email = 'seu-email@dominio.com';
```

Não disponibilize promoção de perfil na tela pública de cadastro.

## 3. Executar localmente

Requisitos: Node.js 20+ e npm.

```bash
git clone https://github.com/SEU_USUARIO/supermarket-pdv.git
cd supermarket-pdv
npm install
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env` no lugar do `cp`.

Preencha `.env`:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon
SUPABASE_SERVICE_ROLE_KEY=sua-chave-service-role
APP_ORIGIN=http://localhost:3000
```

A API usa a `service_role` no servidor; a `anon key` fica reservada para eventual uso público do Supabase Auth e não é necessária pelo frontend desta implementação.

Inicie:

```bash
npm start
```

Abra http://localhost:3000. Para emular o ambiente Vercel localmente, instale dependências e execute `npm run dev`.

## 4. Testes

```bash
npm test
```

Os testes unitários cobrem validação de e-mail/senha, markup e regra de estoque crítico. Para testes integrados de autenticação, autorização e transações, crie um projeto Supabase de teste separado e não use dados reais.

## 5. Publicar no GitHub

1. Crie um repositório vazio no GitHub, sem README automático.
2. Na pasta do projeto:

```bash
git init
git add .
git commit -m "feat: versão inicial do Supermarket PDV"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/supermarket-pdv.git
git push -u origin main
```

3. Confirme que `.env` não foi enviado. Se uma credencial for publicada por engano, revogue/rotacione imediatamente no Supabase.

## 6. Publicar na Vercel

1. Entre em https://vercel.com e escolha **Add New > Project**.
2. Importe o repositório GitHub.
3. Framework Preset: **Other**. Root Directory: `./`.
4. Em **Environment Variables**, cadastre:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_ORIGIN` com a URL de produção, por exemplo `https://seu-projeto.vercel.app`
5. Faça Deploy.
6. Em cada alteração de variável, faça novo deploy.
7. No Supabase, atualize Authentication > URL Configuration com a URL Vercel.

O `vercel.json` direciona `/api/*` para o Express e os demais caminhos para `public/`.

## Endpoints

| Método | Rota | Permissão |
|---|---|---|
| POST | `/api/auth/register` | Público (perfil inicial Vendedor) |
| POST | `/api/auth/login` | Público |
| GET | `/api/auth/me` | Autenticado |
| GET/POST | `/api/products` | Estoque, Gerente ou Diretor (GET também Vendedor) |
| PATCH | `/api/products/:id` | Estoque, Gerente ou Diretor |
| POST | `/api/sales` | Vendedor, Gerente ou Diretor |
| GET/POST | `/api/finance/entries` | Administrativo ou Diretor |
| GET/PATCH | `/api/users` | Diretor |

Envie `Authorization: Bearer <access_token>` nas rotas protegidas.

## Regras de negócio e observações importantes

- Markup é `(preço de venda - custo) / custo`. Exemplo: custo R$ 10 e venda R$ 15 = 50%.
- Estoque crítico: quantidade <= 3.
- `create_sale` bloqueia as linhas dos produtos e realiza venda, itens e baixa de estoque na mesma transação.
- O perfil do usuário é lido do banco em cada requisição; esconder menus no frontend não substitui autorização.
- A tela de cadastro público atribui Vendedor. O primeiro Diretor é promovido manualmente pelo SQL inicial.
- Financeiro nesta versão registra entradas/saídas manuais. A integração automática de recebimentos com vendas a prazo, conciliação bancária, caixa/turnos, emissão fiscal, descontos, devoluções, auditoria e relatórios gerenciais requerem módulos adicionais.

## Antes de usar em produção

Este repositório é uma base funcional inicial, não substitui homologação. Antes de operar com dinheiro real:
- configure SMTP próprio e fluxo de recuperação de senha;
- implemente rate limiting, logs estruturados, auditoria e monitoramento;
- revise CORS para aceitar somente o domínio real;
- adicione testes de integração para cada perfil e concorrência de vendas;
- implemente idempotência de venda e trilha de auditoria;
- valide regras fiscais, meios de pagamento e LGPD com especialistas;
- faça backup e teste restauração do banco.
