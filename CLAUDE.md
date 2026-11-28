# Loja e Assistência

Sistema de gestão para loja de celulares e assistência técnica. A especificação está em `SPEC.md` (regras de negócio vencem descrições de tela). Decisões tomadas onde a spec é omissa ficam em `DECISIONS.md`: registre ali toda nova escolha.

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm install` | Instala o monorepo (Node 22.19, pnpm 10) |
| `pnpm db:up` / `pnpm db:down` | Sobe/para só o Postgres (Docker, porta 55490) |
| `pnpm dev` | Sobe o banco e roda API (3390) e web (5190) em paralelo |
| `pnpm migrate` | `prisma migrate dev` (cria/aplica migrations no banco de dev) |
| `pnpm migrate:deploy` | Aplica migrations sem gerar novas (produção) |
| `pnpm seed` | Popula o banco vazio com dados de demonstração (`SEED_DEMO=false` pula vendas/OS) |
| `pnpm db:reset` | Apaga o banco de dev, reaplica migrations e roda o seed |
| `pnpm test` | Testes unitários (`packages/shared`) e de integração da API |
| `pnpm test:unit` / `pnpm test:api` | Cada suíte separada |
| `pnpm test:e2e` | Playwright (banco `loja_e2e`) |
| `pnpm typecheck` / `pnpm lint` | `tsc` em todos os pacotes |
| `pnpm build` | Gera o client Prisma e o build do front |
| `pnpm backup` | `pg_dump` em `backups/` |
| `docker compose up -d --build` | Produção local: Postgres + API + web (nginx) |
| `docker-compose.prod.yml` | Produção no VPS (projeto `loja`): Postgres, API, web e `cloudflared`, sem portas publicadas. Segredos no `.env` do servidor (modelo em `.env.prod.example`). Passo a passo em `DEPLOY.md` |
| `scripts/prod-deploy.sh` / `prod-backup.sh` / `prod-restore.sh` | No servidor: atualizar (pull + backup + build), backup para o bucket via rclone (`BACKUP_REMOTE`) e restauração (`latest` ou um arquivo) |
| `pnpm --filter @loja/api bootstrap` | Banco vazio de produção: estrutura + um Administrador vindo de `ADMIN_*` (roda sozinho no início do container) |

Os testes da API usam `TEST_DATABASE_URL` (banco `loja_test`, criado por `docker/init-databases.sql`) e truncam tudo a cada arquivo. Para rodar só a API: `pnpm test` dentro de `apps/api` (aceita caminho de arquivo).

O E2E (`apps/web/e2e`) sobe API e web próprios nas portas 3391 e 5191, com o banco `loja_e2e` zerado e populado (base + catálogo) a cada execução; pode rodar com o `pnpm dev` ligado.

`pnpm db:reset` é bloqueado para agentes pela proteção do Prisma contra ações destrutivas: peça para o usuário rodar. Scripts avulsos com `tsx` precisam de extensão `.mts`. Quando `pnpm migrate` recusa por ambiente não interativo (ex.: índice único novo), gere o SQL com `npx dotenv -e ../../.env -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` em `apps/api`, salve em `prisma/migrations/<timestamp>_<nome>/migration.sql` e aplique com `pnpm migrate:deploy`.

Usuários do seed (senha `loja12345`; entra com o e-mail ou com o usuário): `carlos@loja.test`/`admin` (Administrador, o dono), `ana@loja.test`/`ana` (Caixa/Atendente), `diego@loja.test`/`diego` e `rafael@loja.test`/`rafael` (Técnicos). Não existe perfil Gerente: o dono cria perfis em Equipe.

## Estrutura

- `packages/shared`: regras puras compartilhadas. `money/` (taxas, repasse, carrinho, checkout, resumo do dia), formatos BR, período em America/Sao_Paulo, permissões, schemas zod, templates de WhatsApp.
- `apps/api`: Fastify 5 + Prisma 7 (`prisma-client` em `src/generated/prisma`, adapter `PrismaPg`).
  - `http/router.ts`: toda rota declara o nível de acesso (`'public' | 'auth' | permissão | permissão[]`). A tabela de rotas gera os testes de 403.
  - `http/redact.ts`: remove campos de custo (`product.cost.view`) e financeiros (`finance.view`) de qualquer resposta.
  - `lib/audit.ts`: `audit(tx, {...})` dentro da mesma transação da mudança.
  - `lib/clock.ts`: use `deps.clock.now()`; nunca `new Date()` em regra de negócio (os testes usam `FixedClock`).
- `apps/web`: React 19 + Vite 8 + Tailwind 4 + TanStack Query/Table + radix-ui. Alias `@/` para `src/`.
- Ordem de serviço: rotas em `apps/api/src/modules/service-orders.ts`; saldo/A receber em `services/receivables.ts`; resumo da Início em `services/summary.ts`. No front, `pages/service-orders/` (quadro e lista) e `features/service-orders/` (kanban com dnd-kit, ficha, formulário, orçamento, documentos de impressão, fluxo de entrega). Regra de "atrasada" só em `isLate`/`LATE_STAGE_TYPES` de `@loja/shared`: API, Início e filtro do quadro usam a mesma.
- Relatórios e auditoria: API em `modules/reports.ts` (inclui `/api/team/performance`) e `services/reports.ts`; `modules/audit.ts`. No front, `features/reports/` (uma aba por arquivo, inclusive `items-tab.tsx` de Itens vendidos; `shared.tsx` tem `useReport`, `ReportFrame`, `ExportButton` e o sufixo de período do CSV) e `pages/audit/` + `features/audit/details-dialog.tsx`. Rótulos de ação/campo e o diff da auditoria ficam em `@loja/shared/audit` (`auditActionLabel`, `auditDiff`, `AUDIT_GROUPS`): ação nova auditada ganha rótulo ali. CSV é gerado no navegador (`lib/csv.ts`, `formatCsvMoney`); o do Histórico busca todas as linhas em `/api/sales/export`, que reaproveita `listWhere`/`listRow` da lista de vendas (filtro e escopo mudam nos dois juntos).
- Seed: `apps/api/prisma/seed.ts` chama `src/seed/` (base, catálogo, demonstração). As OS de demonstração passam pela própria API via `app.inject`, com `FixedClock` em cada dia: mudança de regra de OS que quebre o seed aparece ali.

## Convenções

- Código, tabelas, variáveis e commits em inglês. Interface e mensagens em pt-BR.
- Dinheiro é sempre inteiro em centavos (`*Cents`); percentuais em basis points (`*Bps`, 499 = 4,99%). Arredondamento só pelas funções de `@loja/shared/money`.
- Datas gravadas em UTC; "dia" e "mês" sempre em America/Sao_Paulo (`resolvePeriod`, `dayKey`).
- Toda permissão é conferida no backend. O front só esconde.
- Nada financeiro é apagado: cancelamento gera estorno. Cadastros são desativados/anonimizados.
- Sem comentários no código.
- Valores negativos com "−" explícito (`formatMoney`).
- Cores só por token (`apps/web/src/styles.css`, tabela em `DECISIONS.md` > Paleta); nada de hex solto em componente (exceção: o balão de prévia do WhatsApp em Configurações). Texto vermelho é `text-primary-text`; `primary` fica para fundo, borda, foco e gráfico.
- Coluna de `DataTable` aceita `meta: { className }` (vai no `th` e no `td`); use para esconder coluna no celular (`hidden sm:table-cell`) e repita a informação como linha embaixo na célula principal (`sm:hidden`). Coluna só de desktop usa `xl:`/`2xl:`, não `lg:`: com a barra lateral, a área útil a 1024 px é ~736 px.
- Celular: grade sempre com `grid-cols-1` explícito; nada de `truncate`/`line-clamp` em célula sem breakpoint (`sm:truncate`); nunca `min-w-max` em tabela; imagem em linha flex leva `shrink-0`. Para conferir estouro horizontal, o contêiner de rolagem é o `main` do AppShell, não o `body`.
- Telas novas entram em `App.tsx` sob demanda: `const XPage = page(() => import('./pages/x.tsx'), 'XPage')`.
- Card de lista: link "Ver todos" no cabeçalho com `ListCard action` + `CardLink` (`features/dashboard/shared.tsx`), discreto; nada de rodapé vermelho.
- Wrapper com `overflow-x-auto` leva `relative` (senão `sr-only`/inputs absolutos estouram a largura da página no celular).
- Ações destrutivas: botão outline + modal de confirmação (`ConfirmDialog`).
- TanStack Table v9: genéricos com `T extends RowData`; não anote arrays de colunas com `Columns<T>`, use `useMemo(() => [...], deps)` e `meta: { align: 'right' }` para alinhar.
- Formulários: react-hook-form + schemas de `@loja/shared`. Erros da API (`ApiError.fieldErrors()`) voltam para os campos.
- Login: `verifyCredentials` (`http/auth.ts`) procura por e-mail quando o texto tem `@` e por usuário caso contrário; serve para a tela de login e para a autorização inline.
- Aprovação inline: o client de API reenvia com `body.approval` quando a resposta pede aprovação. Vale qualquer usuário com a permissão; nos textos é "autorização", nunca "gerente".
- Novas rotas: registre com nível de acesso no router e confira que o teste de 403 cobre todos os perfis.
- IP do cliente: use `ctx.ip`, nunca `req.ip`. O router e o rate limit leem `clientIp()` (`http/client-ip.ts`), que em produção pega o `cf-connecting-ip` (`CLIENT_IP_HEADER`).
- Banco: índice só em FK, colunas quentes e unicidade; sem `CHECK` constraints. Validação de valor é do serviço/schema.
- BOM em string (CSV) é sempre o escape `\uFEFF`, nunca o caractere invisível: as ferramentas de edição às vezes gravam o literal; confira com `grep -rl $'\xef\xbb\xbf' apps packages`.
- Não há prettier no projeto: estilo é aspas simples, ponto e vírgula, vírgula final e linhas longas (~200). Não rode `npx prettier` (usa os padrões e reformata tudo).
- Para conferir o seed sem tocar no banco de dev, use um banco descartável no mesmo Postgres: `DATABASE_URL=.../loja_seedcheck npx prisma migrate deploy && npx tsx prisma/seed.ts`, depois apague o banco.

## Portas e ambiente

`.env` na raiz (veja `.env.example`). Banco 55490, API 3390, web 5190, todos em 127.0.0.1. O Vite faz proxy de `/api` e `/uploads` para a API; em Docker o nginx faz o mesmo.

Para testar o `docker-compose.prod.yml` sem tocar no banco de dev, suba com outro nome de projeto e um env descartável: `docker compose -p loja-prodcheck -f docker-compose.prod.yml --env-file <arquivo> up -d --build --wait`. Como não publica portas, teste por dentro (`... exec -T web wget -qO- http://127.0.0.1/api/health`). Sem `-p` o projeto é `loja` (o de produção), não o de dev, mas use sempre o mesmo `-p` para subir e derrubar. O `cloudflared` exige `CLOUDFLARE_TUNNEL_TOKEN`; fora do servidor, troque o serviço por um container parado num compose extra.

Os scripts `prod-*.sh` rodam `docker compose` sem flags, então para testá-los aqui exporte `COMPOSE_PROJECT_NAME=loja-prodcheck`, `COMPOSE_FILE=docker-compose.prod.yml` e `COMPOSE_ENV_FILES=<env descartável>`, aponte `BACKUP_REMOTE` para uma pasta local e ponha no `PATH` um `rclone` que rode a imagem `rclone/rclone` montando essa pasta e `/var/folders` (onde o `mktemp` do macOS cria os temporários).
