# Especificação — Sistema de Gestão para Loja e Assistência Técnica

Nov 26, 2026 · @Anderson Soares Martins

## Como usar com o Claude Code

Este documento é a fonte da verdade do projeto. Exporte como Markdown, salve como `SPEC.md` na raiz do repositório e peça ao Claude Code: "Leia o SPEC.md inteiro e implemente a Fase 1. Ao final de cada fase, rode os testes e me mostre o que ficou pronto."

Instruções para o agente:

1. Leia o documento inteiro antes de escrever código. Em caso de conflito, as Regras de negócio prevalecem sobre a descrição das telas.
2. Trabalhe por fases (seção Fases de entrega). Só avance quando os critérios de aceite da fase passarem.
3. Crie um `CLAUDE.md` com os comandos do projeto (dev, test, lint, migrate, seed) e as convenções abaixo.
4. Código, tabelas, variáveis e commits em inglês. Toda a interface, mensagens e textos em português do Brasil.
5. Valores em dinheiro sempre em centavos (inteiro). Nunca use número de ponto flutuante para dinheiro.
6. Toda permissão é validada no backend. Esconder um botão no front é só conveniência.
7. "Dia" e "mês" em resumos e relatórios usam o fuso America/Sao\_Paulo. Datas ficam gravadas em UTC.
8. Quando algo não estiver especificado, escolha a opção mais simples, registre em `DECISIONS.md` e siga em frente.
9. Crie dados de exemplo (seed) realistas de uma assistência de celulares para testar todas as telas.

## Visão geral

É um sistema web para uma loja pequena que vende produtos e faz assistência técnica. Ele controla o caixa do dia, as vendas, as ordens de serviço (OS) e mostra quanto a loja realmente ganhou depois de taxas e custos.

É uma única loja, com 1 a 10 usuários: o dono (administrador), atendente/caixa e técnico. O uso principal é no computador do balcão, mas OS e Kanban precisam funcionar bem no celular.

**Entra no MVP:**

- Home com resumo do dia e do mês
- Caixa: abertura, entradas avulsas, saídas, custos e fechamento com conferência
- Vendas (PDV) com várias formas de pagamento, parcelas e cálculo de taxas
- Histórico de vendas, com cancelamento e estorno
- Ordens de serviço em Kanban configurável, com ação de WhatsApp por coluna
- Orçamento (da OS e de venda), impressão e envio por WhatsApp
- Recebimento da OS integrado à venda e controle do que está pendente (a receber)
- Clientes, produtos, serviços e estoque
- Taxas configuráveis
- Equipe, perfis e permissões
- Relatórios básicos e log de auditoria

**Fica fora da v1:**

- Emissão fiscal (NF-e, NFC-e, NFS-e). O comprovante é "não fiscal".
- API oficial do WhatsApp. A v1 usa links `wa.me` que abrem o WhatsApp com a mensagem pronta, e o envio é um clique manual.
- Integração com maquininha/TEF, conciliação bancária e Pix com confirmação automática.
- Multiloja, e-commerce e app nativo.
- Portal público para o cliente aprovar orçamento pelo link. Deixe a arquitetura preparada para isso.

## Stack e arquitetura

É um monorepo TypeScript com front em React, API em Node e banco PostgreSQL. Use as versões estáveis mais recentes no momento em que o projeto for criado.

| Camada | Escolha |
| --- | --- |
| Monorepo | pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` |
| Front | React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui (Radix) e ícones lucide-react |
| Rotas | React Router |
| Dados no front | TanStack Query |
| Formulários | React Hook Form + Zod |
| Tabelas | TanStack Table |
| Kanban | dnd-kit (arrastar com mouse, toque e teclado) |
| Gráficos | Recharts |
| API | Node.js + Fastify + TypeScript |
| Banco e ORM | PostgreSQL + Prisma (migrations versionadas) |
| Validação | Zod, com schemas compartilhados em `packages/shared` |
| Autenticação | Sessão em cookie httpOnly, senha com argon2, limite de tentativas no login |
| Impressão | Páginas HTML com CSS de impressão (80 mm, 58 mm e A4) |
| Testes | Vitest (unidade e integração) e Playwright (ponta a ponta) |
| Infra | Docker Compose (postgres, api, web), `.env.example` e script de backup com `pg_dump` |

Regras de arquitetura:

- Todo cálculo de dinheiro (totais, taxas, troco, resumo) fica em `packages/shared/money`. O front usa para mostrar a prévia e a API usa para gravar o valor oficial.
- A API sempre recalcula. Ela nunca confia em total ou taxa enviados pelo front.
- Operações que mexem em venda, pagamento, estoque e caixa rodam numa única transação do banco. Se uma parte falhar, nada é gravado.
- Nada financeiro é apagado. Cancelar gera estorno, e o registro original continua no histórico.
- Numeração sequencial e legível: vendas `V-000123`, OS `OS-000045`, orçamentos `ORC-000012`.

## Identidade visual

O tema padrão é escuro: fundo `#06110c`, superfícies `#171717` e destaque vermelho `#E93737`. Defina tudo como tokens CSS (variáveis do Tailwind/shadcn) para trocar as cores num lugar só. Um tema claro derivado é opcional.

| Token | Valor | Uso |
| --- | --- | --- |
| `background` | `#06110c` | Fundo da aplicação |
| `surface` | `#171717` | Cards, menu lateral, modais, colunas do Kanban |
| `surface-2` | `#202020` | Hover, campos de formulário, linhas alternadas |
| `border` | `#2A2A2A` | Divisórias e bordas |
| `primary` | `#E93737` | Destaque, item ativo do menu, foco, links, série principal dos gráficos |
| `primary-solid` | `#C92A2A` | Fundo dos botões primários com texto branco |
| `text` | `#F5F5F5` | Texto principal |
| `text-muted` | `#A3A3A3` | Texto secundário, rótulos |
| `success` | `#22C55E` | Valores positivos, caixa aberto, pago |
| `warning` | `#F59E0B` | Estoque baixo, OS parada, diferença no caixa |
| `info` | `#38BDF8` | Avisos neutros |

Regras de uso:

- **Contraste:** `#E93737` sobre o fundo dá cerca de 4,6:1 e serve para texto. Texto branco sobre `#E93737` dá só cerca de 4,1:1, abaixo do mínimo de 4,5:1. Por isso botões sólidos usam `#C92A2A` (cerca de 5,5:1 com branco).
- **Vermelho da marca x vermelho de erro:** como o vermelho é a cor da marca, ações destrutivas (cancelar venda, excluir) usam botão contornado, ícone e modal de confirmação. Valores negativos levam sinal "−" explícito, e a cor não é o único sinal.
- **Tipografia:** Inter, com números tabulares (`tabular-nums`) em todo valor e tabela.
- **Formatos:** moeda `R$ 1.234,56` via `Intl.NumberFormat('pt-BR')`, datas `dd/mm/aaaa`, telefone `(48) 99999-9999`.
- **Estilo:** limpo e profissional, cantos de 8 px, sem gradientes. Estados vazios explicam o próximo passo ("Nenhum custo registrado hoje").
- **Logo:** placeholder até o dono enviar. Fica configurável em Configurações e aparece no menu e nos comprovantes.

## Regras de negócio

O resumo só fecha certo se todo dinheiro passar por um caixa aberto e cada movimento tiver um tipo claro. Esta seção define esses tipos, as taxas, a ligação da OS com a venda e as fórmulas.

### Dinheiro e histórico

- Valores em centavos (inteiro). Arredonde a taxa por pagamento, meio para cima.
- Preço, custo e percentual de taxa são copiados para a venda no momento em que ela é feita. Mudar o cadastro depois não altera o histórico.

### Caixa

- Só existe um caixa aberto por vez (loja única).
- Abertura: usuário, data/hora e valor inicial em dinheiro (fundo de troco).
- Toda venda, recebimento de OS, sinal, entrada avulsa, saída e custo fica ligado ao caixa aberto. Sem caixa aberto essas ações ficam bloqueadas e a tela mostra o botão "Abrir caixa".
- Entradas avulsas e custos têm forma de pagamento. O custo indica se saiu da gaveta (dinheiro do caixa) ou de outra conta.

| Tipo de movimento | Exemplo | Entra no resultado? | Mexe na gaveta? |
| --- | --- | --- | --- |
| Recebimento de venda/OS | Pagamento de venda, sinal ou saldo de OS | Sim (receita) | Só se for dinheiro, já sem o troco |
| Entrada avulsa — receita | Serviço rápido sem cadastro, venda de sucata | Sim (receita) | Só se for dinheiro |
| Entrada avulsa — suprimento | Dono coloca troco no caixa | Não | Sim (+) |
| Saída — sangria/retirada | Dono leva dinheiro para o cofre ou banco | Não | Sim (−) |
| Custo registrado | Peça comprada, frete, lanche, conta de luz | Sim (−) | Só se pago com dinheiro do caixa |
| Estorno | Cancelamento de venda | Sim (−) | Só se for dinheiro |

No fechamento, o sistema mostra o valor esperado por forma de pagamento. O usuário informa quanto contou em dinheiro e o sistema calcula a sobra ou falta. Diferença diferente de zero exige observação. O fechamento gera um relatório imprimível e, depois disso, o caixa vira somente leitura. Reabrir exige permissão e fica no log.

```latex
\text{Dinheiro esperado} = \text{Abertura} + \text{Recebido em dinheiro (sem troco)} + \text{Entradas em dinheiro} - \text{Sangrias} - \text{Custos pagos do caixa} - \text{Estornos em dinheiro}
```

### Formas de pagamento e taxas

- As formas são Dinheiro, Pix, Débito e Crédito (1x a 12x).
- Uma venda aceita vários pagamentos, por exemplo R$ 100 no Pix e R$ 50 em dinheiro. A soma tem que fechar o total. Só o dinheiro pode passar do total, e a diferença vira troco.
- Em Configurações › Taxas há um percentual para Pix, débito e dinheiro (padrão 0%) e um percentual para cada parcela do crédito (1x a 12x). Também há uma taxa fixa opcional em R$ por transação, o número máximo de parcelas e a parcela mínima.
- A taxa é calculada e gravada em cada pagamento:

```latex
\text{Taxa} = \operatorname{round}(\text{valor} \times \text{percentual}) + \text{taxa fixa}
```

- Quem paga a taxa é configurado por forma. Em "Loja absorve" (padrão), o cliente paga o preço e a loja recebe menos. Em "Repassar ao cliente", o sistema acrescenta a taxa para a loja receber o valor cheio:

```latex
\text{Valor cobrado} = \operatorname{round}\left(\frac{\text{valor desejado}}{1 - \text{percentual}}\right)
```

- No pagamento em crédito, o PDV mostra um simulador de 1x a 12x com valor da parcela, total cobrado e líquido para a loja. O líquido só aparece para quem pode ver taxas.
- Cancelar uma venda estorna o pagamento e a taxa dele.
- Prazo de recebimento da maquininha (D+1, D+30) fica fora da v1. O resultado conta na data da venda.

### Venda

- Cada item pode ser um produto do catálogo (com estoque), um serviço do catálogo ou um item avulso (nome e preço digitados). O item tem nome, quantidade, preço unitário, desconto e subtotal. A venda tem descrição opcional.
- O desconto pode ser por item ou no total, em R$ ou %. Cada perfil tem um limite de desconto, e acima dele pede permissão.
- O cliente é opcional na venda de balcão. É obrigatório em venda com saldo pendente e em toda OS.
- Status possíveis: `orcamento`, `concluida`, `pendente` (pago em parte ou nada, com saldo a receber) e `cancelada`.
- Ao concluir: baixa o estoque, grava os pagamentos no caixa, calcula as taxas, gera o número e abre o comprovante.
- Cancelar exige permissão e motivo. Devolve o estoque e lança o estorno no caixa aberto. Se o caixa da venda já foi fechado, o estorno entra no caixa atual.
- Orçamento de venda: salva com validade em dias, envia por WhatsApp ou imprime, e depois vira venda com um clique. Ao converter, os preços e o estoque são conferidos de novo.

### Ordem de serviço e ligação com a venda

A OS nunca vira dinheiro sozinha. O valor só entra no caixa quando passa pelo mesmo checkout do PDV, e aí nasce uma venda vinculada à OS. Assim o histórico de vendas, o caixa e o resumo ficam sempre certos.

&#91;embedded content: fluxo da OS até a venda · colunas padrão resumidas\]

Só o botão Receber e entregar gera a venda. Se sobrar saldo, a venda fica em A receber até o cliente pagar.

Cada coluna do Kanban tem um **tipo de etapa**, e as regras usam o tipo, não o nome da coluna. Assim o dono pode renomear e criar colunas à vontade.

| Tipo de etapa | Colunas padrão | O que o sistema faz |
| --- | --- | --- |
| `entrada` | Recebido | OS recém-aberta |
| `andamento` | Em análise, Orçamento enviado, Aguardando aprovação, Em conserto, Aguardando peça | Conta tempo parado na coluna |
| `pronto` | Pronto para retirada | Mostra o botão "Receber e entregar" e entra em "A receber" se houver saldo |
| `finalizado` | Entregue | Somente leitura e início da garantia |
| `cancelado` | Não aprovado / Cancelado | Somente leitura, sem venda |

Fluxo completo:

1. O balcão abre a OS com cliente, aparelho, defeito relatado, checklist de entrada, previsão e técnico. O comprovante de entrada pode ser impresso ou enviado por WhatsApp.
2. O técnico faz o diagnóstico e lança os itens do orçamento: peças do estoque, serviços e mão de obra.
3. O orçamento vai para o cliente por WhatsApp. A aprovação é registrada manualmente, com quem aprovou, quando e por qual canal. Se o cliente recusar, a OS vai para `cancelado`, com taxa de diagnóstico opcional.
4. Opcional: o cliente paga um sinal. O sinal é um pagamento ligado à OS, entra no caixa aberto e conta no resumo do dia em que foi recebido.
5. Com o conserto pronto, a OS vai para "Pronto para retirada" e o sistema oferece a mensagem de WhatsApp avisando o cliente, com o valor restante.
6. Quando o cliente chega, o atendente clica em **Receber e entregar** no card. Abre o checkout do PDV com os itens da OS já carregados e o sinal descontado.
7. Ao confirmar, numa única transação, o sistema cria a venda com `origem = OS`, grava os pagamentos no caixa e baixa as peças do estoque. Também move a OS para "Entregue" e registra a data de entrega e o início da garantia.
8. Se o cliente levar o aparelho sem pagar tudo (exige permissão), a venda fica `pendente` e entra em "A receber". O saldo é recebido depois, total ou em partes, sempre pelo caixa aberto.

Regras da OS:

- Cada OS tem no máximo uma venda. A venda aparece no Histórico com a etiqueta "OS-000045" e link para a OS.
- As peças saem do estoque no faturamento. Ao lançar uma peça na OS, o sistema mostra o disponível (estoque menos o que já está em OS abertas) e avisa se faltar.
- Garantia em dias (padrão configurável, por exemplo 90). Uma OS de retorno em garantia fica vinculada à OS original.
- OS "parada": mais de N dias na mesma coluna (N configurável). OS "atrasada": previsão vencida. As duas ganham selo no card.

### O que está pendente

- **A receber:** vendas `pendente` com saldo e OS em etapa `pronto` com saldo em aberto. Aparece na Home e numa lista própria, com botão para receber.
- **OS paradas e atrasadas:** contador na Home e filtro no Kanban.
- **Orçamentos sem resposta:** orçamentos de venda e OS aguardando aprovação há mais de N dias.

### Fórmulas do resumo

O resumo usa regime de caixa: conta o que foi recebido e pago no período, pela data do pagamento ou do movimento. O período pode ser hoje (padrão), ontem, este mês ou um intervalo.

| Indicador | Como calcular |
| --- | --- |
| Recebido em vendas e OS | Soma dos pagamentos recebidos no período (vendas, sinais, saldos de OS), sem troco e já descontados os estornos |
| Quantidade de vendas e ticket médio | Vendas concluídas no período; ticket = total vendido ÷ quantidade |
| Entradas avulsas | Receitas avulsas. Suprimentos aparecem à parte e não entram no resultado |
| Saídas de caixa | Sangrias e retiradas. Não entram no resultado |
| Taxas | Soma das taxas dos pagamentos do período |
| Custo dos produtos vendidos (CMV) | Custo copiado na venda × quantidade, nas vendas concluídas no período |
| Custos registrados | Soma dos custos lançados. Se for zero, mostra "Nenhum custo registrado" |
| Resultado estimado | Fórmula abaixo |
| Dinheiro esperado na gaveta | Fórmula do caixa, só para o caixa aberto |
| A receber | Total das pendências em aberto, independente do período |

```latex
\text{Resultado estimado} = \text{Recebido} + \text{Receitas avulsas} - \text{Taxas} - \text{CMV} - \text{Custos registrados}
```

É "estimado" porque usa o custo cadastrado dos produtos e porque um sinal entra no dia em que foi pago, enquanto o custo da peça entra no dia da entrega. O resumo também mostra cada forma de pagamento com bruto, taxa e líquido.

## Telas e módulos

O menu lateral tem Início, Caixa, Vender, Histórico, Ordens de serviço, Clientes, Produtos e estoque, Relatórios, Equipe e Configurações. Cada item só aparece para quem tem permissão. A barra do topo mostra o status do caixa ("Aberto por Ana desde 08:12" ou "Fechado"), uma busca global por cliente, OS ou venda, e o usuário logado.

### Início (Home)

- Seletor de período: Hoje, Ontem, Este mês, Intervalo.
- Cards dos indicadores da seção Fórmulas do resumo, com o Resultado estimado em destaque.
- Gráfico: vendas por hora (hoje) ou por dia (mês).
- Tabela por forma de pagamento: bruto, taxa e líquido.
- Mini-resumo das OS por etapa, mais os contadores de paradas e atrasadas.
- Listas curtas: A receber, Estoque baixo e Últimas vendas.
- Quem não pode ver o financeiro vê uma Home reduzida, só com as próprias vendas do dia e as próprias OS.

### Caixa

- Botão Abrir caixa, com o valor inicial.
- Com o caixa aberto: botões Entrada avulsa (receita ou suprimento), Saída (sangria) e Registrar custo (categoria, descrição, valor, forma, se saiu da gaveta).
- Extrato do caixa em ordem de hora, com tipo, descrição, forma, valor, usuário e link para a venda ou OS.
- Fechar caixa: esperado por forma, campo do dinheiro contado, diferença, observação e relatório imprimível.
- Aba Histórico de caixas: lista de fechamentos com diferenças e quem fechou.

### Vender (PDV)

- Busca de produto por nome ou código de barras. O leitor USB funciona como teclado, e um bip de leitura adiciona o item direto.
- Carrinho com quantidade, preço (editável com permissão), desconto por item e subtotal.
- Campos: cliente (busca ou cadastro rápido com nome e WhatsApp), desconto no total e descrição opcional.
- Botões: Salvar como orçamento, Finalizar venda.
- Modal de pagamento: adicionar um ou mais pagamentos, cada um com forma, valor e parcelas (se crédito), simulador de parcelas, taxa calculada (só para quem pode ver taxas), troco, falta pagar e confirmar.
- Depois de finalizar: comprovante com imprimir (80 mm, 58 mm, A4), enviar por WhatsApp e nova venda.
- Atalhos: F2 busca produto, F4 cliente, F8 desconto, F10 finalizar, Esc cancelar.

### Histórico de vendas

- Tabela com filtros: período, vendedor, forma de pagamento, status, origem (balcão ou OS) e busca por número ou cliente.
- Detalhe da venda: itens, pagamentos, taxas, custo e margem (com permissão), OS vinculada e log.
- Ações: reimprimir, reenviar por WhatsApp, receber saldo (se pendente) e cancelar (com permissão e motivo).
- Aba Orçamentos: lista com validade, status e Converter em venda.

### Ordens de serviço (Kanban)

O Kanban é a tela principal da assistência e precisa parecer um produto profissional, no nível de Trello ou Linear.

**Quadro**

- Colunas com nome, cor, contador de cards e soma dos valores (com permissão).
- Arrastar e soltar entre colunas e reordenar dentro da coluna, com dnd-kit, animação suave e suporte a toque e teclado.
- No celular: rolagem horizontal por coluna e menu "Mover para…" no card.
- Filtros: técnico, busca (cliente, aparelho, número, IMEI), atrasadas, paradas e período. Botão para alternar entre quadro e lista.
- Colunas `finalizado` e `cancelado` mostram só os últimos 30 dias, com link "ver todas".
- Botão Nova OS no topo.

**Card**

- Número, nome do cliente, aparelho (marca e modelo), defeito em uma linha e avatar do técnico.
- Valor do orçamento e selo "Pago" ou "Saldo R$ X".
- Selos de atrasada, parada, aguardando peça e garantia.
- Tempo na coluna atual ("há 3 dias").
- Botão WhatsApp, se a coluna tiver a ação ligada. Botão Receber e entregar, se a etapa for `pronto`.

**Detalhe da OS** (painel lateral ao clicar no card)

- Resumo: cliente (com botão WhatsApp), aparelho (tipo, marca, modelo, cor, número de série/IMEI), senha ou padrão de desbloqueio (oculta, com botão "mostrar" e permissão), acessórios deixados, checklist de entrada, defeito relatado, diagnóstico, previsão, técnico e garantia.
- Orçamento: itens (peças, serviços, mão de obra), desconto, total, aprovação (quem, quando, canal) e botões Imprimir e Enviar por WhatsApp.
- Pagamentos: sinal e saldo.
- Linha do tempo: cada mudança de coluna, edição, mensagem aberta no WhatsApp e pagamento, com usuário e hora.
- Impressões: comprovante de entrada (via do cliente, com termo), orçamento e comprovante de entrega com garantia.

**Configuração das colunas** (Configurações › Kanban e mensagens)

- Criar, renomear, reordenar, mudar a cor e arquivar colunas. Cada coluna tem um tipo de etapa.
- Campos obrigatórios ao entrar na coluna (opcional). Exemplo: só entra em "Orçamento enviado" com pelo menos um item; só entra em "Pronto" com diagnóstico preenchido.
- **Ação WhatsApp da coluna** (liga e desliga):
  - Gatilho: "perguntar ao mover para esta coluna" ou "só botão no card".
  - Modelo de mensagem com variáveis e prévia ao vivo.
  - Ao disparar, abre `https://wa.me/55DDDNUMERO?text=<mensagem codificada>` numa nova aba, com a mensagem pronta. O sistema registra na linha do tempo "WhatsApp aberto por Ana", sem afirmar que foi enviado.

Variáveis dos modelos: `{cliente}`, `{primeiro_nome}`, `{numero_os}`, `{aparelho}`, `{defeito}`, `{valor_total}`, `{valor_restante}`, `{previsao}`, `{garantia_dias}`, `{loja}`, `{telefone_loja}`, `{endereco_loja}`.

Modelos padrão (o dono edita):

| Coluna | Mensagem |
| --- | --- |
| Recebido | Olá, {primeiro\_nome}! Recebemos seu {aparelho}. O número da sua OS é {numero\_os}. Avisaremos assim que o orçamento ficar pronto. {loja} |
| Orçamento enviado | Olá, {primeiro\_nome}! O orçamento do seu {aparelho} (OS {numero\_os}) ficou em {valor\_total}. Podemos seguir com o conserto? |
| Pronto para retirada | Olá, {primeiro\_nome}! Seu {aparelho} está pronto para retirada. Valor a pagar: {valor\_restante}. Endereço: {endereco\_loja}. {loja} |
| Entregue | Obrigado pela preferência, {primeiro\_nome}! Seu serviço tem garantia de {garantia\_dias} dias. Qualquer coisa, é só chamar aqui. |

### Clientes

- Cadastro: nome, WhatsApp (obrigatório, com máscara, gravado no formato +55), CPF opcional e validado, e-mail, endereço e observações.
- Busca por nome, telefone ou CPF. Avisa se já existe cliente com o mesmo telefone.
- Ficha: histórico de vendas e OS, total gasto, pendências, garantias ativas e botão WhatsApp.

### Produtos e estoque

- Abas Produtos, Serviços, Movimentações e Categorias.
- Produto: nome, código/SKU, código de barras, categoria, custo, preço de venda, margem calculada, estoque atual, estoque mínimo, se controla estoque, foto opcional e ativo/inativo.
- Serviço: nome, preço padrão e tempo estimado. Não controla estoque.
- Entrada de estoque (compra): quantidade, custo unitário e fornecedor opcional. Atualiza o custo pelo custo médio ponderado.
- Ajuste de estoque exige motivo e fica no log.
- Movimentações: entrada, venda, uso em OS, ajuste e estorno, com data, usuário e documento de origem.
- Alerta de estoque abaixo do mínimo e importação por CSV (opcional).

### Relatórios

- Vendas por dia no mês, por forma de pagamento, por vendedor e produtos mais vendidos.
- OS por técnico: abertas, concluídas e tempo médio até "Pronto".
- Custos por categoria, taxas por forma e fechamentos de caixa.
- Todos com filtro de período e exportação em CSV.

### Equipe

- Lista de usuários: nome, login, perfil e ativo/inativo. Quem tem histórico é desativado, nunca apagado.
- Criar usuário com senha temporária (troca obrigatória no primeiro login) e redefinir senha.
- Perfis e permissões: matriz editável (seção Permissões).
- Desempenho por pessoa: vendas, ticket médio e OS concluídas no período.

### Configurações

- Loja: nome, CNPJ/CPF, endereço, WhatsApp, logo, horário de atendimento e chave Pix (aparece no comprovante e no orçamento).
- Taxas: tabela da seção Formas de pagamento e taxas.
- Kanban e mensagens.
- Impressão: tamanho padrão, termo de garantia, termo de entrada (aparelho deixado mais de 90 dias etc.) e rodapé.
- Padrões: garantia, validade do orçamento, dias para OS parada, limite de desconto por perfil e categorias de custo.

## Permissões e auditoria

O controle é feito por perfis com permissões granulares. O administrador edita a matriz e pode criar novos perfis. O sistema já vem com quatro perfis padrão.

| Permissão | Admin | Gerente | Caixa/Atendente | Técnico |
| --- | --- | --- | --- | --- |
| Ver resumo financeiro completo (resultado, taxas, custos) | ✓ | ✓ | — | — |
| Ver custo e margem dos produtos | ✓ | ✓ | — | — |
| Abrir e fechar caixa | ✓ | ✓ | ✓ | — |
| Registrar entrada avulsa e suprimento | ✓ | ✓ | ✓ | — |
| Registrar sangria e custos | ✓ | ✓ | — | — |
| Reabrir caixa fechado | ✓ | — | — | — |
| Vender e receber OS | ✓ | ✓ | ✓ | — |
| Alterar preço no PDV | ✓ | ✓ | — | — |
| Desconto acima do limite do perfil | ✓ | ✓ | — | — |
| Entregar OS ou vender com saldo pendente | ✓ | ✓ | — | — |
| Cancelar venda | ✓ | ✓ | — | — |
| Ver histórico de todas as vendas (senão, só as próprias) | ✓ | ✓ | — | — |
| Criar e editar OS | ✓ | ✓ | ✓ | ✓ |
| Ver todas as OS (senão, só as atribuídas e sem técnico) | ✓ | ✓ | ✓ | — |
| Mover OS no Kanban | ✓ | ✓ | ✓ | ✓ |
| Editar orçamento da OS | ✓ | ✓ | — | ✓ |
| Ver senha de desbloqueio do aparelho | ✓ | ✓ | — | ✓ |
| Cadastrar e editar produtos e preços | ✓ | ✓ | — | — |
| Entrada e ajuste de estoque | ✓ | ✓ | — | — |
| Criar e editar clientes | ✓ | ✓ | ✓ | ✓ |
| Ver relatórios | ✓ | ✓ | — | — |
| Gerenciar equipe e perfis | ✓ | — | — | — |
| Configurações (loja, taxas, Kanban, impressão) | ✓ | — | — | — |
| Ver log de auditoria | ✓ | — | — | — |

Regras:

- Cada permissão é uma chave estável no código (ex.: `cash.close`, `sale.cancel`, `finance.view`). Toda rota da API declara a chave que exige e responde 403 sem ela.
- O front esconde menus, botões e colunas (custo, taxa, margem) de quem não tem a permissão.
- Quando falta permissão para uma ação pontual (desconto acima do limite, cancelar), o sistema pode pedir login e senha de um gerente na hora. A ação fica registrada com os dois usuários.

Auditoria e segurança:

- O log registra usuário, data/hora, ação, entidade, valores antes e depois e IP. Ações registradas: login, abertura, fechamento e reabertura de caixa, sangrias, custos, cancelamentos, descontos acima do limite, alteração de preço, ajuste de estoque, mudança de permissões e visualização da senha do aparelho.
- A senha do aparelho do cliente fica criptografada no banco e só aparece para quem tem permissão.
- LGPD: dados de clientes só para usuários logados, com exportação e exclusão (anonimização) do cliente a pedido, mantendo os registros financeiros.
- Senha de usuário com mínimo de 8 caracteres, sessão que expira e limite de tentativas no login.

## Modelo de dados

As entidades abaixo são o mínimo. Valores em centavos (`Int`), datas em UTC e chaves em UUID. Toda entidade tem `createdAt`, `updatedAt` e, quando fizer sentido, `createdById`.

| Entidade | Campos principais | Observações |
| --- | --- | --- |
| `StoreSettings` | name, document, address, whatsapp, logoUrl, pixKey, defaults (warrantyDays, quoteValidityDays, staleOsDays) | Linha única |
| `User` | name, login, passwordHash, roleId, active, mustChangePassword | Nunca apagar com histórico |
| `Role` / `RolePermission` | name, discountLimitPct / roleId, permissionKey | Perfis editáveis |
| `Customer` | name, phoneE164, cpf?, email?, address?, notes | Telefone único (aviso, não bloqueio) |
| `Product` | type (product, service), name, sku, barcode, categoryId, costCents, priceCents, stockQty, minStock, tracksStock, active | Serviço não controla estoque |
| `StockMovement` | productId, type (purchase, sale, os\_use, adjust, reversal), qty (+/−), unitCostCents, reason, refType, refId | Fonte da verdade do estoque |
| `FeeRule` | method (cash, pix, debit, credit), installments (1–12, só crédito), percentBps, fixedCents, passToCustomer | Percentual em pontos-base (4,99% = 499) |
| `CashSession` | openedById, openedAt, openingCents, closedById?, closedAt?, countedCashCents?, expected (por forma), differenceCents?, notes | Só uma aberta por vez |
| `CashMovement` | sessionId, type (payment, income, supply, withdrawal, expense, reversal), method, amountCents, feeCents, fromDrawer, categoryId?, description, refType, refId | Base do resumo e do fechamento |
| `Sale` | number, status (quote, completed, pending, cancelled), origin (counter, os), serviceOrderId?, customerId?, sellerId, subtotalCents, discountCents, totalCents, paidCents, notes, quoteValidUntil?, cancelReason? | `paidCents` < total = pendente |
| `SaleItem` | saleId, productId?, name, qty, unitPriceCents, unitCostCents, discountCents, totalCents | Snapshot de preço e custo |
| `Payment` | saleId? ou serviceOrderId? (sinal), cashSessionId, method, installments, amountCents, feeCents, feePercentBps, changeCents, receivedAt, receivedById | Sinal é religado à venda no faturamento |
| `ServiceOrder` | number, customerId, deviceType, brand, model, color, serialImei, unlockSecretEnc, accessories, checklist (JSON), reportedIssue, diagnosis, technicianId, columnId, columnEnteredAt, position, dueAt, approval (by, at, channel), warrantyDays, deliveredAt, saleId?, parentOsId? | `parentOsId` para retorno em garantia |
| `ServiceOrderItem` | serviceOrderId, productId?, kind (part, service, labor), name, qty, unitPriceCents, unitCostCents | Vira `SaleItem` no faturamento |
| `ServiceOrderEvent` | serviceOrderId, type (created, moved, edited, whatsapp\_opened, payment, approved), fromColumnId?, toColumnId?, data (JSON), userId | Linha do tempo |
| `KanbanColumn` | name, color, order, stageType (entry, in\_progress, ready, done, cancelled), requiredFields (JSON), whatsappEnabled, whatsappTrigger (on\_move, manual), templateId?, archived | Tipo de etapa guia as regras |
| `MessageTemplate` | name, body | Variáveis `{...}` |
| `ExpenseCategory` | name, active | Peças, aluguel, energia, alimentação etc. |
| `AuditLog` | userId, approvedById?, action, entity, entityId, before (JSON), after (JSON), ip | Somente inserção |
| `Counter` | key (sale, os, quote), value | Numeração sequencial com lock na transação |

## Fases de entrega e critérios de aceite

São quatro fases, cada uma utilizável ao terminar. Uma fase só termina com os testes passando e com os cenários de aceite dela conferidos.

1. **Base:** monorepo, Docker, banco, autenticação, usuários, perfis e permissões, layout com tema e menu, clientes, produtos, serviços, estoque, configurações da loja e seed.
2. **Caixa e vendas:** taxas, caixa (abertura, movimentos, fechamento), PDV com vários pagamentos e parcelas, comprovantes, histórico, cancelamento, orçamento de venda e Home com o resumo.
3. **Ordens de serviço:** Kanban configurável, card, detalhe, orçamento da OS, ações de WhatsApp, sinal, Receber e entregar, A receber, garantia e impressões da OS.
4. **Acabamento:** relatórios, tela de auditoria, desempenho da equipe, exportação CSV, PWA instalável, revisão de acessibilidade e de uso no celular.

### Cenários de aceite

Taxas de exemplo só para os testes (não são as taxas reais): Pix 0,99%, débito 1,99%, crédito 1x 3,49%, 2x 4,49%, 3x 4,99%, dinheiro 0%.

| Cenário | Passos | Resultado esperado |
| --- | --- | --- |
| A. Crédito parcelado | Venda de R$ 300,00 no crédito 3x | Taxa R$ 14,97, líquido R$ 285,03 |
| B. Pagamento dividido | Venda de R$ 150,00: R$ 100,00 no Pix e R$ 50,00 em dinheiro | Taxa total R$ 0,99. Sem os dois pagamentos fechando R$ 150,00, o botão confirmar fica bloqueado |
| C. Troco | Venda de R$ 50,00, cliente entrega R$ 100,00 em dinheiro | Troco R$ 50,00. Recebido em dinheiro R$ 50,00 |
| D. Fechamento | Abertura R$ 100,00; venda C (produto com custo R$ 20,00); sangria R$ 30,00; custo de R$ 20,00 pago da gaveta; contado R$ 95,00 | Esperado na gaveta R$ 100,00, falta R$ 5,00, observação obrigatória. Resultado do dia R$ 10,00 |
| E. OS do início ao fim | OS com peça (custo R$ 80,00, preço R$ 150,00) e mão de obra R$ 100,00. Dia 1: sinal de R$ 50,00 no Pix. Dia 2: Receber e entregar com R$ 200,00 no crédito 2x | Dia 1: resultado R$ 49,50 (taxa R$ 0,50). Dia 2: venda de R$ 250,00 com origem OS, taxa R$ 8,98, estoque da peça −1, OS em Entregue, garantia iniciada, resultado R$ 111,02 |
| F. Cancelamento | Cancelar a venda A no mesmo dia, com motivo | Estoque devolvido, estorno de R$ 300,00 e da taxa, resumo do dia volta ao valor anterior, ação no log |
| G. Repasse da taxa | Crédito 3x com "repassar ao cliente", valor desejado R$ 300,00 | Cobrado R$ 315,76, taxa R$ 15,76, líquido R$ 300,00 |
| H. Saldo pendente | Gerente entrega a OS recebendo só R$ 100,00 de R$ 250,00 | Venda `pendente` com saldo R$ 150,00 em A receber; caixa não permite isso com perfil Caixa |
| I. Permissões | Técnico tenta cancelar venda pela API; Caixa abre a Home e o PDV | 403 para o técnico. Caixa não vê custo, taxa nem resultado, e a API não devolve esses campos |
| J. Kanban e WhatsApp | Mover OS para "Pronto para retirada" com a ação ligada | Pergunta se quer avisar; ao confirmar, abre `wa.me` com a mensagem preenchida e registra na linha do tempo |

### Testes

- Unidade: todo `packages/shared/money` (taxas, repasse, troco, resumo, fechamento) cobrindo os cenários A a H.
- Integração na API: venda, cancelamento, faturamento da OS e fechamento de caixa, conferindo que tudo roda em transação e que uma falha no meio não deixa dado pela metade.
- Permissões: um teste por rota protegida, conferindo o 403 para cada perfil sem a chave.
- Ponta a ponta (Playwright): abrir caixa, vender, fechar caixa; e uma OS do Recebido até o Entregue.

## Decisões em aberto

Estas perguntas ainda precisam do dono da loja. Enquanto ele não responder, o Claude Code segue com o padrão indicado e registra em `DECISIONS.md`.

- [ ] Nome do sistema e logo. Padrão: "\[Nome da Loja\]" e logo placeholder.
- [ ] Ordem das cores. Padrão: `#06110c` fundo, `#171717` superfícies, `#E93737` destaque.
- [ ] Taxas reais da maquininha (Pix, débito e crédito 1x a 12x) e se alguma é repassada ao cliente. Padrão: tudo 0% e loja absorve, preenchido depois em Configurações.
- [ ] Um caixa único ou um por atendente? Padrão: caixa único.
- [ ] Peças saem do estoque na entrega ou quando o técnico aplica? Padrão: na entrega.
- [ ] Cobrar taxa de diagnóstico quando o orçamento é recusado? Padrão: opcional por OS.
- [ ] Quais etapas ele usa hoje na assistência? Padrão: as colunas da seção Ordem de serviço.
- [ ] Garantia padrão em dias. Padrão: 90.
- [ ] Comissão para vendedor ou técnico? Padrão: fora da v1.
- [ ] Onde vai rodar: servidor na nuvem (VPS, Railway, Render) ou computador da loja? Padrão: Docker Compose, que roda nos dois.
- [ ] Precisa de nota fiscal agora? Padrão: não. Se precisar, vira uma integração separada com um emissor.
