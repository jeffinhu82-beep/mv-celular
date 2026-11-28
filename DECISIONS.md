# Decisões

Escolhas feitas onde a `SPEC.md` é omissa ou ambígua. Regra geral: a opção mais simples que cumpre a regra de negócio.

## Decisões em aberto da spec (padrões adotados)

| Tema | Padrão |
| --- | --- |
| Nome da loja | `[Nome da Loja]`, editável em Configurações → Loja |
| Taxas | Todas 0% e absorvidas pela loja até alguém configurar |
| Caixas | Um único caixa físico (uma sessão aberta por vez) |
| Peças da OS | Reservadas ao entrar na OS, saem do estoque na entrega |
| Taxa de diagnóstico | Opcional por OS |
| Garantia | 90 dias, configurável |
| Comissão | Não há |
| Implantação | VPS com Docker Compose e Cloudflare Tunnel, sem painel (`docker-compose.prod.yml`, `scripts/prod-*.sh`, passo a passo em `DEPLOY.md`) |
| Nota fiscal | Fora do escopo |

## Dinheiro, taxas e resumo

- Cada pagamento grava valor cobrado, valor que quita a venda, acréscimo de repasse, troco e taxa. O resumo nunca recalcula com a taxa atual.
- Repasse ao cliente: `cobrado = round((desejado + fixo) / (1 − pct))`. O fixo entra no cálculo para a loja receber o valor cheio.
- Pagamento em dinheiro não tem taxa. Entrada avulsa também não.
- CMV é contado quando a venda é concluída e subtraído de volta no cancelamento.
- "Vendas" no resumo conta vendas concluídas e não canceladas.
- Esperado por forma de pagamento ignora custos pagos fora da gaveta.
- Cancelamento cai na sessão de caixa aberta quando a sessão original já foi fechada.
- Estoque insuficiente bloqueia a venda (não há venda com estoque negativo).

## Ordem de serviço

- Orçamento de OS usa o número da OS. Orçamento de venda é a própria venda com número `ORC-`.
- Sinal é um pagamento ligado à OS e religado à venda no faturamento.
- Estoque disponível = estoque − peças reservadas em OS abertas.
- OS reprovada com taxa de diagnóstico vai para a coluna de pronto e fatura só a taxa. Sem taxa, vai para cancelado.
- O quadro precisa de pelo menos uma coluna ativa de cada etapa: entrada, pronto, finalizado e cancelado. Coluna de entrada, andamento ou pronto só é arquivada vazia.
- Coluna com WhatsApp ligado exige texto da mensagem. Gatilho "ao mover" pergunta antes de abrir o `wa.me`; "manual" só pelo botão do card.
- "Atrasada" = previsão vencida enquanto a OS está em entrada ou andamento. Pronta, entregue ou cancelada não conta, porque o conserto já terminou.
- Mover card usa `afterId`: `null` põe no topo da coluna, ausente põe no fim, um id põe logo abaixo daquele card.
- Atualização parcial de OS mantém os campos omitidos.
- Checklist de entrada: `true` = OK, `false` = defeito, ausente = não testado. Observações ficam na chave `observacoes`.
- Senha de padrão gravada como a sequência de pontos `1-4-7-8` (grade 3×3, numerada da esquerda para a direita, de cima para baixo).
- Previsão de entrega é digitada como data e hora de São Paulo e gravada em UTC.
- Ao abrir uma OS, o comprovante de entrada abre na hora; a ficha da OS abre quando ele fecha.
- A ficha tem "Mover para…", que segue o mesmo fluxo do arrastar (aviso de WhatsApp, entrega, confirmação de cancelamento).
- Sinal usa o mesmo diálogo de pagamento em modo parcial. O botão some quando a OS fica pronta: aí o caminho é "Receber e entregar".
- Soltar card em "finalizado" abre o fluxo de entrega quando permitido; se não, o card volta e aparece um aviso. Soltar em "cancelado" pede confirmação.
- O aviso de WhatsApp "ao mover" mostra a mensagem antes de abrir o `wa.me`, e a abertura fica na linha do tempo.
- Filtros do quadro ficam na URL. Os próprios do quadro têm nome em pt-BR (`tecnico`, `atrasadas`, `paradas`, `todas`, `ver=lista`); busca e período reaproveitam `q`, `period`, `from` e `to` das outras telas.

## Acesso e dados

- O backend remove campos de custo (sem `product.cost.view`) e financeiros (sem `finance.view`) de qualquer resposta, num hook global.
- Quem não vê finanças recebe a configuração de taxas zerada (o PDV ainda calcula repasse no servidor).
- Quem edita produto sem ver custo mantém o custo gravado (o campo não é obrigatório no PUT).
- Sem perfil Gerente (pedido do cliente, 26/11/2026; a matriz da spec tinha quatro perfis). O dono da loja é o Administrador e cria em Equipe os perfis e usuários que quiser, escolhendo as permissões de cada um. Perfis padrão: Administrador, Caixa/Atendente e Técnico.
- A aprovação inline (desconto acima do limite, saldo a receber, cancelamento, reabrir caixa) aceita qualquer usuário cujo perfil tenha a permissão pedida. Os textos falam em "autorização", não em "gerente".
- O Administrador tem todas as permissões e elas não podem ser alteradas. Ninguém pode desativar a si mesmo.
- Perfis personalizados só podem ser excluídos sem usuários. Perfis do sistema não são excluídos.
- Clientes são anonimizados, nunca apagados. Usuários e produtos são desativados.
- Limite de desconto é editável em Equipe → Perfis e em Configurações → Padrões. O log só registra os perfis que mudaram.
- Upload de imagem aceita PNG, JPG e WEBP até 2 MB. SVG fica de fora (pode carregar script).
- Os testes injetam pontos de falha (`deps.failpoints`, só em memória) para provar o rollback das transações.

## Autenticação

- Bloqueio de 15 minutos depois de 5 senhas erradas seguidas, registrado no log.
- Limite de 20 tentativas de login por minuto por IP.
- Atrás da Cloudflare, o IP do cliente vem do cabeçalho de `CLIENT_IP_HEADER` (`cf-connecting-ip`), usado no limite de login, na sessão e na auditoria. Com o cabeçalho presente, o `X-Forwarded-For` não conta, porque qualquer um forja. O cabeçalho só é confiável porque a origem não tem porta aberta: o tráfego entra pelo túnel. Sem a variável (dev e Docker local) ou sem o cabeçalho na requisição, vale o `req.ip` do Fastify.
- Sessão de 12 horas, renovada a cada uso, em cookie `httpOnly` (`sid`).
- Usuário novo recebe senha temporária gerada na tela (mostrada uma vez) e troca no primeiro acesso.
- Senhas com argon2id.
- Entrada por e-mail e senha. O campo aceita também o usuário (identificador curto, fixo depois de criado): se o texto tem `@`, procura por e-mail; senão, por usuário. Os dois em minúsculas e sem espaços nas pontas. O mesmo vale na autorização inline ("E-mail ou usuário de quem autoriza"), que é onde o usuário curto mais ajuda no balcão.
- E-mail é obrigatório ao criar usuário e pode ser trocado na edição; é único. A coluna no banco é anulável só para os usuários que já existiam antes dele (a obrigatoriedade fica no schema: editar um usuário sem e-mail pede o e-mail). E-mail ou usuário repetido volta como erro do campo, não como 409 genérico.
- Mensagem de erro segue o que foi digitado ("E-mail ou senha incorretos." / "Usuário ou senha incorretos.") e não diz se a conta existe.
- Sem recuperação de senha por e-mail: o sistema não envia e-mail (a spec não pede). Quem esquece pede ao dono, que gera senha temporária em Equipe.

## Cadastros e estoque

- Estoque inicial do cadastro vira movimentação de ajuste. O estoque do seed entra como compra.
- Entrada de mercadoria recalcula custo médio ponderado.
- Estoque baixo é `estoque < mínimo`.
- Produto com preço 0 é peça "só OS" e não aparece no PDV.
- Importação de CSV é tudo ou nada: uma linha inválida cancela o arquivo e a tela mostra os erros por linha.
- Telefone repetido avisa, mas não bloqueia.
- Busca global: clientes por nome/telefone/CPF, OS e vendas pelo número; cada resultado respeita as permissões.

## Interface

- Campo de dinheiro estilo caixa eletrônico (digita da direita para a esquerda).
- Diálogos viram folha inferior no celular.
- Em dev o Vite faz proxy da API (sem CORS). Em Docker o nginx faz o mesmo.
- Todos os itens do menu da spec estão entregues; cada um aparece só para quem tem a permissão do módulo.
- Auditoria é item próprio do menu (permissão `audit.view`). "A receber" fica dentro de Histórico.
- Ordem das colunas do quadro é salva de forma otimista e volta se a API recusar.
- Configurar taxas substitui todas as regras pelas linhas exibidas. Reduzir o máximo de parcelas descarta as faixas acima.
- PWA com ícone maskable próprio (512 px) e `apple-touch-icon` em PNG. É instalável e guarda a casca do app em cache (abre sem rede até a tela de login), mas precisa da API para funcionar: nada de fila offline. Atualiza sozinho (`autoUpdate`); o nginx manda `no-cache` em `sw.js` e `index.html`, e o service worker não intercepta `/api` nem `/uploads`.

## Paleta (substitui a tabela de Identidade visual da spec)

Pedido do dono da loja: manter o vermelho e fazer o resto combinar com ele. A spec não foi alterada; os valores valem a partir daqui.

| Token | Spec | Adotado | Motivo |
| --- | --- | --- | --- |
| `background` | `#06110c` | `#110e0e` | O fundo verde-escuro brigava com o vermelho; neutros grafite levemente quentes (matiz ~20°) acompanham o destaque |
| `surface` | `#171717` | `#1a1716` | Mesma família quente |
| `surface-2` | `#202020` | `#221e1d` | Campos e linhas alternadas |
| `surface-hover` | — | `#272221` | Hover de linhas e itens (antes cor solta `#242424`) |
| `surface-3` | — | `#2c2726` | Chips e controles sobre `surface-2` |
| `border` | `#2A2A2A` | `#2e2928` | Divisórias |
| `border-strong` | — | `#403937` | Hover de bordas e barra de rolagem (antes `#3a3a3a` solto) |
| `primary` | `#E93737` | `#E93737` | Mantido: preenchimentos, borda de foco, item ativo, barras do gráfico |
| `primary-solid` | `#C92A2A` | `#C92A2A` | Mantido: fundo de botão com texto branco (5,46:1) |
| `primary-text` | — | `#f25e5e` | Texto vermelho pequeno (links, item ativo, valores): `#E93737` sobre as superfícies fica abaixo de 4,5:1; este dá ≥ 4,59:1 em todas, inclusive sobre `primary/10` |
| `text` | `#F5F5F5` | `#f7f3f2` | Branco levemente quente |
| `text-muted` | `#A3A3A3` | `#aea5a3` | ≥ 6,1:1 em todas as superfícies |
| `success` | `#22C55E` | `#4cc38a` | Verde-jade menos saturado, não compete com o vermelho |
| `warning` | `#F59E0B` | `#f0a83c` | Âmbar mais suave |
| `info` | `#38BDF8` | `#79aee0` | Azul acinzentado |

- Classe para texto vermelho é `text-primary-text`; `text-primary` não é usada (ficaria abaixo de AA). Fundo, borda e anel continuam em `primary`.
- Gráfico de vendas por dia usa `primary` (a spec diz que é a série principal; antes estava azul).
- Cores das colunas do quadro harmonizadas na mesma família (seed e presets de Configurações): Recebido `#79AEE0`, Em análise `#A99AE6`, Orçamento enviado `#F0A83C`, Aguardando aprovação `#EC8A4C`, Em conserto `#E93737`, Aguardando peça `#E27BA8`, Pronto `#4CC38A`, Entregue `#2F9D6B`, Cancelado `#8C8381`. Colunas criadas pelo dono mantêm a cor que ele escolheu.
- Ícones do PWA, `theme-color` e manifesto usam o fundo `#110e0e`.
- Sem logo cadastrado, a marca mostra a inicial do nome da loja (`storeInitial`), ignorando colchetes e símbolos.
- Contraste conferido por script (cores com transparência compostas sobre o fundo real) nas rotas principais em 1366 px e 390 px, mais login, ficha da OS, diálogo de pagamento e venda pendente: nenhum texto abaixo de 4,5:1 (3:1 para texto grande). O atalho `F10` dentro do botão vermelho usa fundo `black/20` (com `white/15` ficava em 4,39:1).
- Cor padrão de coluna no banco passou de `#A3A3A3` para `#8C8381` (migration `kanban_color_default`); na prática a API sempre recebe a cor.
- Caixas com `overflow-x-auto` levam `relative`: rótulos `sr-only` e inputs nativos absolutos escapavam da rolagem e faziam a página inteira rolar para o lado no celular.
- Card "Formas de pagamento" da Início tem 3 colunas (Forma, Bruto, Líquido); a taxa aparece em linha menor sob o líquido. Com 4 colunas o líquido era cortado na grade de 3 colunas.
- Na linha do tempo da venda, `sale.completed` aparece como "Venda registrada com saldo a receber" quando a venda nasceu com saldo (status `pending` no registro, venda ainda pendente ou com recebimento de saldo posterior).

## Caixa, PDV e histórico

- Formulários do caixa usam estado controlado. O valor de abertura sugere o último contado.
- O Caixa/Atendente tem os botões Sangria e Custo; o gerente aprova na hora, no mesmo diálogo.
- Reabrir aparece para quem tem `cash.reopen` ou `cash.open_close`.
- Preço no PDV é editável por todos; mudar o preço pede aprovação (`sale.price_override`).
- Taxas ficam mascaradas para quem não vê finanças.
- Orçamento pode ser salvo com o caixa fechado. Orçamento vencido não é convertido: a API devolve 409, a lista mostra "Vencido" e o PDV bloqueia com aviso.
- Cancelar orçamento usa `sale.cancel`. A lista de orçamentos mostra todas as situações.
- Quantidade no carrinho limitada ao estoque disponível já na tela.
- Leitor de código de barras: busca exata ao apertar Enter.
- Atalhos: F4 limpa o cliente; Esc descarta a venda só quando não há diálogo aberto.
- "Deixar pendente" fica no modal de pagamento. Ao converter um orçamento, "Salvar como orçamento" some.
- Modal de pagamento (venda, entrega de OS, sinal e saldo): sem forma escolhida, mostra "Como o cliente vai pagar?" com as quatro formas. Depois de escolher, cada forma vira uma linha (sem numeração) e os botões "Pagar o restante com" só aparecem enquanto falta valor; o novo pagamento já entra com o que falta. O total aparece uma vez, grande, no resumo, com o estado: "Falta pagar" (aviso), "Troco" (grande) ou "Pagamento completo". Taxas e líquido ficam no rodapé do resumo, só para quem vê finanças. A simulação de 1x a 12x é um botão neutro, para não parecer erro. No celular o resumo vem antes das linhas.
- Cancelar venda pode ser aprovado por gerente na hora.
- Detalhe da venda é página própria (`/vendas/:id`). O card de resultado some em venda cancelada.
- "Margem após taxas" = total − custo − taxas + acréscimo de repasse.
- `reversedFeeCents` também é removido para quem não vê finanças.
- Histórico abre no mês corrente; filtros ficam na URL. Orçamentos cancelados não aparecem no histórico de vendas.
- Totais do histórico ignoram vendas canceladas e respeitam os filtros.
- Mensagens de WhatsApp usam os modelos padrão de `@loja/shared` no front.
- Impressão usa um portal próprio com `@page` dinâmico (cupom 80 mm ou A4).
- O E2E usa banco (`loja_e2e`) e portas próprias (API 3391, web 5191) para não tocar no banco de dev.

## Início

- Quem tem `finance.view` vê o resumo completo; o período padrão é hoje e fica na URL.
- Layout enxuto (pedido do dono depois da primeira versão): uma faixa de resumo no topo com o Resultado estimado em destaque e, ao lado, Vendas (total, quantidade e ticket médio), Recebido, Dinheiro na gaveta e A receber, sem caixas separadas. Depois vêm o gráfico e as formas de pagamento, os cards de OS, A receber e Estoque baixo, e as últimas vendas.
- Desvio da tela da spec ("cards dos indicadores"): os indicadores da composição do Resultado (recebido, entradas avulsas, taxas, custo dos produtos, custos registrados e "Nenhum custo registrado" quando não há) ficam atrás de "Ver composição", não em cards; "Dinheiro esperado na gaveta" virou "Dinheiro na gaveta" com a legenda "Esperado agora"; aberto ou fechado fica salvo no navegador. Linhas zeradas somem; "Fora do resultado" (suprimentos e saídas de caixa, que movem dinheiro e não geram lucro) só aparece se tiver valor.
- Formas de pagamento listam só as formas usadas no período (sem nenhuma, "Nenhum pagamento no período"), com bruto, líquido e a taxa embaixo do líquido; o total só aparece com duas formas ou mais.
- OS: contadores de atrasadas e paradas sempre visíveis; etapas sem OS somem.
- As três listas curtas (A receber, Estoque baixo, Últimas vendas) mostram 5 itens; o link "Ver todos" fica no cabeçalho do card. O tipo (venda ou OS) sai do prefixo do número, sem selo. Últimas vendas mostram a situação só quando não é "Concluída"; no celular o cliente vai embaixo do número e somem as colunas Quando e Vendedor.
- O gráfico mostra o total das vendas concluídas: por hora em "hoje/ontem" (8h às 18h, estendido se houver venda fora disso) e por dia nos demais períodos. Sem vendas, o eixo de valores some e fica só o aviso.
- Links da Início respeitam permissão: quem não abre o módulo vê o item como texto.
- O card "A receber" leva à aba `/vendas?aba=receber`; "Estoque baixo" leva a `/produtos?estoque=baixo`, que já abre filtrado.
- Na aba A receber (`/vendas?aba=receber`), a coluna Descrição mostra o número da OS + aparelho (venda de OS) ou o primeiro item + "N itens". No card da Início, só a OS pronta mostra o aparelho; venda mostra cliente e idade.
- Resumo reduzido: vendas do dia só para quem tem `sale.create` (quantidade e total no cabeçalho do card, sem caixas à parte); OS só para quem tem alguma permissão de OS (OS atrasada mostra o selo e o prazo sem destaque).
- A tela se atualiza sozinha a cada 60 s.

## Relatórios, auditoria e desempenho

- Relatórios (`report.view`) em quatro abas na URL (`?aba=itens`, `?aba=os`, `?aba=financeiro`); período padrão é o mês corrente, com o mesmo seletor da Início.
- "Recebido" e "Recebido por forma" vêm do caixa (como na Início), então incluem pagamentos de OS e sinais; "Vendas" conta só vendas concluídas pela data de conclusão.
- OS concluída = primeira entrada numa coluna de etapa Pronto ou Entregue dentro do período; tempo médio vai da abertura até essa entrada. Abertas = criadas no período.
- Custos e taxas da aba Financeiro só para `finance.view`; sem ela a aba mostra só os fechamentos de caixa. Clicar num fechamento abre o relatório do caixa só para quem tem alguma permissão de caixa ou `finance.view`.
- CSV: cada tabela exporta a si mesma no navegador (sem rota de CSV na API). Separador `;`, BOM UTF-8, vírgula decimal sem milhar, valores em reais com "(R$)" no cabeçalho, horas em decimal. Nome do arquivo com o período: `vendas-por-dia_2026-11-01_a_2026-11-30.csv`.
- Histórico → Vendas exporta em CSV todas as vendas do filtro atual, não só a página: o botão busca `/api/sales/export`, que usa o mesmo filtro e o mesmo escopo da lista (quem não tem `sale.view_all` exporta só as próprias vendas). Uma linha por venda, com formas de pagamento, itens (`2x Produto`), desconto, total e saldo a receber. Sem custo. Com Situação em "todas", as canceladas vêm junto (coluna Situação), como na lista; para somar o vendido, filtre Concluída ou some sem as canceladas.
- Itens vendidos (`?aba=itens`, `/api/reports/sale-items`): uma linha por item das vendas que a aba Vendas conta (concluídas e pendentes pela data de conclusão), sem as canceladas. O total do item já desconta o desconto do item, mas não rateia o desconto dado no total da venda (igual a Mais vendidos), por isso a soma pode passar um pouco do total vendido. Busca e paginação no navegador (50 por página), sem limite de linhas; clicar abre a venda só para quem tem `sale.view_all`. Sem colunas de custo.
- Desempenho fica em Equipe → Desempenho (`team.manage`, rota `/api/team/performance`), não em Relatórios: é dado de pessoa.
- Auditoria: período padrão é o mês; filtros por grupo de ação (prefixo, ex.: `auth.`) e por pessoa, incluindo usuários inativos marcados "(inativo)". 50 por página.
- Ações e campos aparecem com rótulos em pt-BR (`@loja/shared/audit`). O detalhe mostra só os campos que mudaram, com botão para ver os demais; mudança de perfil lista permissões adicionadas e removidas.

## Desempenho do front e celular

- Telas carregadas sob demanda (`React.lazy`), inclusive a Início, para o gráfico (recharts) não pesar no bundle inicial. Se um deploy novo invalidar um chunk já aberto, a tela de erro diz "O sistema foi atualizado" e só oferece recarregar.
- Tabelas no celular: colunas secundárias somem (`hidden sm:table-cell`) e a informação vai como linha embaixo na célula principal. Colunas só de desktop usam `xl:`, não `lg:`: com a barra lateral (lg+), a área útil a 1024 px é ~736 px.
- `DataTable` não força largura mínima: o texto quebra para caber. Ficam com rolagem horizontal de propósito só a matriz de permissões (primeira coluna fixa), as tabelas de taxas, o quadro Kanban e as faixas de abas.
- Histórico de vendas: o filtro e a coluna de pagamento se chamam "Forma".

## Seed

- Senha de todos os usuários: `loja12345`.
- E-mails dos usuários do seed no domínio reservado `.test` (`carlos@loja.test`, `ana@loja.test`, `diego@loja.test`, `rafael@loja.test`), que nunca entrega mensagem de verdade.
- O seed só roda em banco vazio. Para recriar: `pnpm db:reset`.
- Produção não usa o seed: a API roda `prisma/bootstrap.ts` a cada início. Com o banco sem usuários e `ADMIN_EMAIL` definido, cria perfis, colunas, modelos de mensagem, taxas zeradas, categorias de despesa e um único Administrador com `ADMIN_PASSWORD` como senha temporária (troca obrigatória no primeiro acesso). Não cria produto, cliente nem os usuários `.test`, e deixa CNPJ, endereço, WhatsApp e chave Pix em branco para o dono preencher. Tudo numa transação. Com usuários no banco, não faz nada.
- O seed de demonstração configura taxas típicas (Pix 0,99%, débito 1,99%, crédito 1x 3,49%, 2x 4,49%, 3x 4,99%, +0,5% por parcela acima de 3x). Instalação limpa (`SEED_DEMO=false`) começa com tudo em 0%.
- A venda pendente do seed é da Ana, aprovada pelo dono (admin).
- As OS de demonstração são criadas pela própria API (`app.inject`) com o relógio de cada dia, então passam pelas mesmas regras, auditoria e caixa que o uso real. Cobrem todas as colunas, sinal, entrega pendente, retorno em garantia e recusas com e sem taxa.
- Desconto de técnico acima do limite dele, no seed, usa aprovação inline do dono (admin), como na tela.

## Produção

- Docker Compose direto no VPS, sem painel. O Dokploy foi considerado e descartado em 2026-11-27: o deploy automático dele pede o painel exposto (e o painel tem histórico de falhas de segurança), ele ocupa memória num VPS pequeno e é mais uma camada para uma loja só. Se um dia fizer sentido, o mesmo `docker-compose.prod.yml` entra nele como app Compose.
- Cada projeto do VPS tem o seu compose e o seu próprio `cloudflared` com o token do seu túnel. Não há rede nem proxy compartilhados, então o `api` de um projeto não colide com o de outro. A rota do túnel aponta para `http://web:80`.
- Nenhuma porta publicada: só `expose`. Firewall com entrada só na 22; como o Docker não publica nada, não precisa de `ufw-docker`.
- O compose de produção tem `name: loja` (volumes `loja_pgdata` e `loja_uploads`), separado do projeto de dev `loja-assistencia`. O `.env` do servidor traz `COMPOSE_FILE=docker-compose.prod.yml`, para `docker compose` funcionar na pasta sem `-f`.
- O nginx resolve `api` pelo DNS do Docker a cada 10 s (`resolver 127.0.0.11`), porque um redeploy só da API troca o IP do container e o nginx guardaria o antigo.
- Logs de container com rotação (10 MB × 3) no próprio compose, para não lotar o disco.
- `pgdata` monta em `/var/lib/postgresql` (layout do Postgres 18). Uploads ficam no volume `uploads`.
- Deploy (`scripts/prod-deploy.sh`): `git pull --ff-only`, backup `-pre-deploy` se o Postgres estiver de pé (sem `BACKUP_REMOTE`, só avisa, para o primeiro deploy poder ser repetido antes do bucket existir), `pull` das imagens prontas (Postgres e `cloudflared` pegam correções), `up --build --wait`, limpeza de imagens. O corpo fica numa função para o `git pull` poder alterar o próprio script.
- Backup (`scripts/prod-backup.sh`, cron diário às 03:00 de São Paulo): `pg_dump -Fc` conferido com `pg_restore --list` antes de subir; rclone para um bucket R2 ou B2 (`BACKUP_REMOTE`). Fotos vão com `rclone copy`, nunca apagadas do bucket. Dumps com mais de 30 dias saem só depois de um envio bem-sucedido. `BACKUP_PING_URL` (healthchecks.io) avisa quando o backup não roda.
- Restauração (`scripts/prod-restore.sh`): escolhe o dump antes de fazer o backup `-pre-restore` (senão `latest` seria ele mesmo), e `latest` ignora os `-pre-restore` (num servidor novo, o `-pre-restore` é o banco vazio e repetir a restauração o traria de volta), carrega em `<banco>_restore` com o sistema no ar, para a API só para trocar os nomes numa transação (`<banco>` vira `<banco>_previous`) e devolve as fotos sem apagar nenhuma. Falha antes da troca deixa o banco atual intacto.
- Servidor novo: sobe com `ADMIN_EMAIL` vazio (o bootstrap não cria ninguém) e restaura o último backup. Com e-mail e sem senha num banco vazio, o bootstrap recusa e a API não sobe.
