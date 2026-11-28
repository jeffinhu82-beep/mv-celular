import { addDays, startOfDay, type PaymentInput } from '@loja/shared';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import type { Db } from '../db.ts';
import { FixedClock } from '../lib/clock.ts';
import { SEED_PASSWORD } from './base.ts';
import type { seedCatalog } from './catalog.ts';

type Catalog = Awaited<ReturnType<typeof seedCatalog>>;
type Login = 'admin' | 'ana' | 'diego' | 'rafael';
type Body = Record<string, unknown>;

type QuoteLine = { part: string; price: number; qty?: number } | { service: string; price?: number } | { labor: string; price: number };

type Action =
  | { do: 'create'; customer: string; device: Body; issue: string; technician?: Login; parent?: string; dueInDays?: number; checklist?: Record<string, boolean | string> }
  | { do: 'edit'; body: Body }
  | { do: 'quote'; lines: QuoteLine[]; discountCents?: number; approvedBy?: Login }
  | { do: 'move'; column: string }
  | { do: 'approve'; decision: 'approved' | 'rejected'; channel: 'presencial' | 'whatsapp' | 'telefone' | 'outro'; feeCents?: number }
  | { do: 'deposit'; payments: PaymentInput[] }
  | { do: 'deliver'; payments: (dueCents: number) => PaymentInput[]; allowPending?: boolean }
  | { do: 'whatsapp'; context: string }
  | { do: 'print'; kind: 'entry' | 'quote' | 'delivery' };

type Step = [back: number, at: number, as: Login, action: Action];

interface DemoOrder {
  key: string;
  steps: Step[];
}

const OK_ALL = { 'Liga normalmente': true, 'Tela sem trincas': true, 'Touch funcionando': true, 'Carrega': true, 'Botões': true };

const ORDERS: DemoOrder[] = [
  {
    key: 'tela-ip11',
    steps: [
      [9, 0.15, 'ana', { do: 'create', customer: 'Mariana Alves', device: { deviceType: 'Celular', brand: 'Apple', model: 'iPhone 11', color: 'Preto', serialImei: '356789104512339', accessories: 'Capinha transparente', unlockType: 'pin', unlockSecret: '2580' }, issue: 'Tela quebrada após queda, touch não responde na parte de baixo.', technician: 'diego', dueInDays: 3, checklist: { 'Liga normalmente': true, 'Tela sem trincas': false, 'Touch funcionando': false, 'Carrega': true, 'Câmera traseira': true } }],
      [9, 0.16, 'ana', { do: 'print', kind: 'entry' }],
      [9, 0.4, 'diego', { do: 'move', column: 'Em análise' }],
      [9, 0.6, 'diego', { do: 'quote', lines: [{ part: 'TEL-IP11', price: 25000 }, { labor: 'Mão de obra', price: 10000 }] }],
      [9, 0.62, 'diego', { do: 'move', column: 'Orçamento enviado' }],
      [9, 0.63, 'diego', { do: 'whatsapp', context: 'on_move' }],
      [8, 0.2, 'ana', { do: 'approve', decision: 'approved', channel: 'whatsapp' }],
      [8, 0.25, 'diego', { do: 'move', column: 'Em conserto' }],
      [8, 0.7, 'diego', { do: 'edit', body: { diagnosis: 'Display e touch danificados. Tela incell substituída e testada.' } }],
      [8, 0.72, 'diego', { do: 'move', column: 'Pronto para retirada' }],
      [8, 0.73, 'diego', { do: 'whatsapp', context: 'on_move' }],
      [7, 0.5, 'ana', { do: 'deliver', payments: (due) => [{ method: 'pix', amountCents: due }] }],
      [7, 0.51, 'ana', { do: 'print', kind: 'delivery' }],
    ],
  },
  {
    key: 'garantia-ip11',
    steps: [
      [1, 0.3, 'ana', { do: 'create', customer: 'Mariana Alves', parent: 'tela-ip11', device: { deviceType: 'Celular', brand: 'Apple', model: 'iPhone 11', color: 'Preto', serialImei: '356789104512339', unlockType: 'pin', unlockSecret: '2580' }, issue: 'Retorno de garantia: touch falhando no canto superior direito.', technician: 'diego', dueInDays: 1, checklist: { ...OK_ALL, 'Touch funcionando': false } }],
      [1, 0.5, 'diego', { do: 'move', column: 'Em análise' }],
    ],
  },
  {
    key: 'tela-a32',
    steps: [
      [5, 0.3, 'ana', { do: 'create', customer: 'João Pedro Silva', device: { deviceType: 'Celular', brand: 'Samsung', model: 'Galaxy A32', color: 'Azul', unlockType: 'pattern', unlockSecret: '1-4-7-8-9' }, issue: 'Tela trincada, imagem com listras verdes.', technician: 'rafael', dueInDays: 4, checklist: { 'Liga normalmente': true, 'Tela sem trincas': false, 'Carrega': true } }],
      [5, 0.6, 'rafael', { do: 'quote', lines: [{ part: 'TEL-A32', price: 22000 }, { labor: 'Mão de obra', price: 8000 }] }],
      [5, 0.62, 'rafael', { do: 'move', column: 'Orçamento enviado' }],
      [4, 0.25, 'ana', { do: 'approve', decision: 'approved', channel: 'telefone' }],
      [4, 0.3, 'ana', { do: 'deposit', payments: [{ method: 'pix', amountCents: 10000 }] }],
      [4, 0.35, 'rafael', { do: 'move', column: 'Em conserto' }],
      [2, 0.55, 'rafael', { do: 'edit', body: { diagnosis: 'Display OLED com aro substituído. Biometria na tela recalibrada.' } }],
      [2, 0.6, 'rafael', { do: 'move', column: 'Pronto para retirada' }],
      [2, 0.61, 'rafael', { do: 'whatsapp', context: 'on_move' }],
    ],
  },
  {
    key: 'bateria-g8',
    steps: [
      [6, 0.2, 'ana', { do: 'create', customer: 'Ricardo Oliveira', device: { deviceType: 'Celular', brand: 'Motorola', model: 'Moto G8 Power', color: 'Azul' }, issue: 'Bateria descarrega em poucas horas e esquenta.', technician: 'rafael', dueInDays: 2, checklist: OK_ALL }],
      [6, 0.5, 'rafael', { do: 'quote', lines: [{ part: 'BAT-G8P', price: 9000 }, { service: 'Troca de bateria' }] }],
      [6, 0.52, 'rafael', { do: 'move', column: 'Orçamento enviado' }],
      [6, 0.8, 'ana', { do: 'approve', decision: 'approved', channel: 'presencial' }],
      [5, 0.3, 'rafael', { do: 'move', column: 'Em conserto' }],
      [5, 0.6, 'rafael', { do: 'edit', body: { diagnosis: 'Bateria original com 61% de saúde. Substituída.' } }],
      [5, 0.62, 'rafael', { do: 'move', column: 'Pronto para retirada' }],
      [3, 0.45, 'admin', { do: 'deliver', payments: () => [{ method: 'pix', amountCents: 7000 }], allowPending: true }],
    ],
  },
  {
    key: 'tela-ip13',
    steps: [
      [3, 0.2, 'ana', { do: 'create', customer: 'Thiago Barbosa', device: { deviceType: 'Celular', brand: 'Apple', model: 'iPhone 13', color: 'Meia-noite', serialImei: '353012116789014', accessories: 'Carregador e cabo', unlockType: 'password', unlockSecret: 'thiago2024' }, issue: 'Tela apagada depois de cair, só vibra.', technician: 'diego', dueInDays: 2, checklist: { 'Liga normalmente': true, 'Tela sem trincas': false, 'Biometria / Face ID': true } }],
      [3, 0.5, 'diego', { do: 'quote', lines: [{ part: 'TEL-IP13', price: 120000 }, { labor: 'Mão de obra', price: 15000 }], discountCents: 5000, approvedBy: 'admin' }],
      [3, 0.52, 'diego', { do: 'move', column: 'Orçamento enviado' }],
      [2, 0.3, 'ana', { do: 'approve', decision: 'approved', channel: 'whatsapp' }],
      [2, 0.35, 'ana', { do: 'deposit', payments: [{ method: 'credit', installments: 1, amountCents: 50000 }] }],
      [1, 0.2, 'diego', { do: 'move', column: 'Em conserto' }],
    ],
  },
  {
    key: 'bateria-a10',
    steps: [
      [4, 0.4, 'ana', { do: 'create', customer: 'Fernanda Costa', device: { deviceType: 'Celular', brand: 'Samsung', model: 'Galaxy A10', color: 'Preto' }, issue: 'Desliga sozinho com 30% de bateria.', technician: 'rafael', dueInDays: 3, checklist: OK_ALL }],
      [4, 0.7, 'rafael', { do: 'quote', lines: [{ part: 'BAT-A10', price: 9000 }, { service: 'Troca de bateria' }] }],
      [3, 0.3, 'ana', { do: 'approve', decision: 'approved', channel: 'telefone' }],
      [3, 0.35, 'rafael', { do: 'move', column: 'Aguardando peça' }],
    ],
  },
  {
    key: 'tela-g60',
    steps: [
      [8, 0.5, 'ana', { do: 'create', customer: 'Patrícia Gomes', device: { deviceType: 'Celular', brand: 'Motorola', model: 'Moto G60', color: 'Verde' }, issue: 'Manchas pretas na tela e brilho falhando.', technician: 'rafael', checklist: { 'Liga normalmente': true, 'Touch funcionando': true } }],
      [8, 0.8, 'rafael', { do: 'quote', lines: [{ part: 'TEL-G60', price: 15000 }, { labor: 'Mão de obra', price: 6000 }] }],
      [7, 0.2, 'rafael', { do: 'move', column: 'Orçamento enviado' }],
      [7, 0.21, 'rafael', { do: 'whatsapp', context: 'on_move' }],
      [6, 0.3, 'ana', { do: 'move', column: 'Aguardando aprovação' }],
    ],
  },
  {
    key: 'bateria-a10-b',
    steps: [
      [2, 0.7, 'ana', { do: 'create', customer: 'Gustavo Ribeiro', device: { deviceType: 'Celular', brand: 'Samsung', model: 'Galaxy A10', color: 'Vermelho' }, issue: 'Bateria estufada levantando a tampa.', technician: 'rafael', dueInDays: 2, checklist: { 'Liga normalmente': true, 'Riscos ou amassados': false } }],
      [1, 0.4, 'rafael', { do: 'quote', lines: [{ part: 'BAT-A10', price: 9000 }, { service: 'Troca de bateria' }] }],
      [1, 0.42, 'rafael', { do: 'move', column: 'Aguardando aprovação' }],
    ],
  },
  {
    key: 'oxidacao-s21',
    steps: [
      [0, 0.1, 'ana', { do: 'create', customer: 'Juliana Pereira', device: { deviceType: 'Celular', brand: 'Samsung', model: 'Galaxy S21', color: 'Cinza' }, issue: 'Caiu na água ontem à noite e não liga mais.', technician: 'diego', dueInDays: 2 }],
      [0, 0.3, 'diego', { do: 'move', column: 'Em análise' }],
      [0, 0.6, 'diego', { do: 'quote', lines: [{ service: 'Limpeza de oxidação' }, { service: 'Backup e formatação' }] }],
      [0, 0.62, 'diego', { do: 'move', column: 'Orçamento enviado' }],
    ],
  },
  {
    key: 'chip-redmi',
    steps: [
      [3, 0.6, 'ana', { do: 'create', customer: 'Eduardo Santos', device: { deviceType: 'Celular', brand: 'Xiaomi', model: 'Redmi Note 11', color: 'Azul', serialImei: '861234056789123' }, issue: 'Não reconhece o chip da operadora.', technician: 'rafael', dueInDays: 1, checklist: { ...OK_ALL, 'Bandeja de chip': true } }],
      [2, 0.2, 'rafael', { do: 'move', column: 'Em análise' }],
    ],
  },
  {
    key: 'ipad-recebido',
    steps: [[0, 0.4, 'ana', { do: 'create', customer: 'Camila Rocha', device: { deviceType: 'Tablet', brand: 'Apple', model: 'iPad 9ª geração', color: 'Prata', accessories: 'Capa com teclado', unlockType: 'pin', unlockSecret: '1234' }, issue: 'Não carrega, conector parece frouxo.' }]],
  },
  {
    key: 'a54-recebido',
    steps: [[0, 0.7, 'ana', { do: 'create', customer: 'Aline Ferreira', device: { deviceType: 'Celular', brand: 'Samsung', model: 'Galaxy A54', color: 'Lilás', unlockType: 'pattern', unlockSecret: '7-4-1-2-3' }, issue: 'Alto-falante chiando em volume alto.', technician: 'diego', dueInDays: 3, checklist: { ...OK_ALL, 'Alto-falante': false } }]],
  },
  {
    key: 'flex-ip8',
    steps: [
      [4, 0.5, 'ana', { do: 'create', customer: 'Lucas Martins', device: { deviceType: 'Celular', brand: 'Apple', model: 'iPhone 8', color: 'Dourado' }, issue: 'Só carrega com o cabo torto.', technician: 'diego', checklist: { 'Liga normalmente': true, 'Carrega': false } }],
      [4, 0.8, 'diego', { do: 'quote', lines: [{ part: 'FLX-IP8', price: 18000 }, { labor: 'Mão de obra', price: 7000 }] }],
      [4, 0.82, 'diego', { do: 'move', column: 'Orçamento enviado' }],
      [3, 0.7, 'ana', { do: 'approve', decision: 'rejected', channel: 'whatsapp' }],
    ],
  },
  {
    key: 'placa-e7',
    steps: [
      [2, 0.4, 'ana', { do: 'create', customer: 'Patrícia Gomes', device: { deviceType: 'Celular', brand: 'Motorola', model: 'Moto E7', color: 'Cinza' }, issue: 'Não liga, esquenta perto da câmera quando conecta o carregador.', technician: 'rafael' }],
      [2, 0.5, 'rafael', { do: 'move', column: 'Em análise' }],
      [2, 0.8, 'rafael', { do: 'edit', body: { diagnosis: 'Curto no circuito de carga da placa. Reparo exige troca de CI de carga.' } }],
      [2, 0.82, 'rafael', { do: 'quote', lines: [{ labor: 'Reparo de placa (CI de carga)', price: 35000 }] }],
      [2, 0.83, 'rafael', { do: 'move', column: 'Orçamento enviado' }],
      [1, 0.6, 'ana', { do: 'approve', decision: 'rejected', channel: 'telefone', feeCents: 5000 }],
    ],
  },
  {
    key: 'bateria-ip11',
    steps: [
      [4, 0.2, 'ana', { do: 'create', customer: 'Fernanda Costa', device: { deviceType: 'Celular', brand: 'Apple', model: 'iPhone 11', color: 'Branco', unlockType: 'pin', unlockSecret: '0852' }, issue: 'Saúde da bateria em 72%, desliga no frio.', technician: 'diego', dueInDays: 3, checklist: OK_ALL }],
      [4, 0.45, 'diego', { do: 'quote', lines: [{ part: 'BAT-IP11', price: 15000 }, { labor: 'Mão de obra', price: 5000 }] }],
      [4, 0.47, 'diego', { do: 'move', column: 'Orçamento enviado' }],
      [3, 0.25, 'ana', { do: 'approve', decision: 'approved', channel: 'presencial' }],
      [3, 0.26, 'ana', { do: 'deposit', payments: [{ method: 'pix', amountCents: 5000 }] }],
      [3, 0.4, 'diego', { do: 'move', column: 'Em conserto' }],
      [1, 0.5, 'diego', { do: 'edit', body: { diagnosis: 'Bateria substituída, saúde 100%. Sem mensagem de peça não original.' } }],
      [1, 0.52, 'diego', { do: 'move', column: 'Pronto para retirada' }],
      [0, 0.5, 'ana', { do: 'deliver', payments: (due) => [{ method: 'credit', installments: 2, amountCents: due }] }],
    ],
  },
];

const MINUTE = 60000;
const RESTAMPED = ['auditLog', 'serviceOrder', 'serviceOrderItem', 'sale', 'saleItem', 'stockMovement', 'payment', 'cashMovement', 'session'] as const;

export async function createServiceOrderSeeder(db: Db, catalog: Catalog, businessOffsets: number[]) {
  const clock = new FixedClock(new Date());
  const config = loadConfig({ logger: false, loginRateLimitPerMinute: 100000 });
  const { app } = await buildApp({ config, db, clock });
  await app.ready();
  const days = [...businessOffsets].sort((a, b) => a - b);
  const ids = new Map<string, string>();
  const columns = new Map((await db.kanbanColumn.findMany()).map((column) => [column.name, column.id]));
  const productNames = new Map((await db.product.findMany({ select: { id: true, name: true, priceCents: true } })).map((product) => [product.id, product]));
  let cookies = new Map<Login, string>();

  const call = async (as: Login, method: 'GET' | 'POST' | 'PUT', url: string, body?: Body) => {
    if (!cookies.has(as)) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: as, password: SEED_PASSWORD } });
      if (response.statusCode !== 200) throw new Error(`Seed de OS: falha no login de ${as}`);
      const raw = response.headers['set-cookie'];
      cookies.set(as, (Array.isArray(raw) ? raw[0]! : String(raw)).split(';')[0]!);
    }
    const response = await app.inject({ method, url, headers: { cookie: cookies.get(as)! }, ...(body ? { payload: body } : {}) });
    if (response.statusCode >= 300) throw new Error(`Seed de OS: ${method} ${url} respondeu ${response.statusCode}: ${response.body}`);
    return response.json() as { id: string; balanceCents: number } & Body;
  };

  const quoteItem = (line: QuoteLine) => {
    if ('part' in line) {
      const productId = catalog.products.get(line.part)!;
      return { productId, kind: 'part', name: productNames.get(productId)!.name, qty: line.qty ?? 1, unitPriceCents: line.price };
    }
    if ('service' in line) {
      const productId = catalog.services.get(line.service)!;
      const product = productNames.get(productId)!;
      return { productId, kind: 'service', name: product.name, qty: 1, unitPriceCents: line.price ?? product.priceCents };
    }
    return { productId: null, kind: 'labor', name: line.labor, qty: 1, unitPriceCents: line.price };
  };

  const perform = async (key: string, as: Login, action: Action, at: Date) => {
    const id = ids.get(key);
    const path = `/api/service-orders/${id}`;
    switch (action.do) {
      case 'create': {
        const created = await call(as, 'POST', '/api/service-orders', {
          customerId: catalog.customers.get(action.customer),
          ...action.device,
          reportedIssue: action.issue,
          checklist: action.checklist ?? {},
          technicianId: action.technician ? (await db.user.findUniqueOrThrow({ where: { login: action.technician } })).id : null,
          parentOsId: action.parent ? ids.get(action.parent) : null,
          dueAt: action.dueInDays !== undefined ? new Date(startOfDay(addDays(at, action.dueInDays)).getTime() + 18 * 60 * MINUTE).toISOString() : null,
        });
        ids.set(key, created.id);
        return;
      }
      case 'edit':
        await call(as, 'PUT', path, action.body);
        return;
      case 'quote':
        await call(as, 'PUT', `${path}/items`, {
          items: action.lines.map(quoteItem),
          discountCents: action.discountCents ?? 0,
          ...(action.approvedBy ? { approval: { login: action.approvedBy, password: SEED_PASSWORD } } : {}),
        });
        return;
      case 'move':
        await call(as, 'POST', `${path}/move`, { columnId: columns.get(action.column) });
        return;
      case 'approve': {
        const customer = await db.serviceOrder.findUniqueOrThrow({ where: { id }, select: { customer: { select: { name: true } } } });
        await call(as, 'POST', `${path}/approval`, { decision: action.decision, by: customer.customer.name, channel: action.channel, diagnosisFeeCents: action.feeCents ?? 0 });
        return;
      }
      case 'deposit':
        await call(as, 'POST', `${path}/deposit`, { payments: action.payments });
        return;
      case 'deliver': {
        const detail = await call(as, 'GET', path);
        await call(as, 'POST', `${path}/deliver`, { payments: action.payments(detail.balanceCents), allowPending: action.allowPending ?? false });
        return;
      }
      case 'whatsapp':
        await call(as, 'POST', `${path}/whatsapp`, { context: action.context });
        return;
      case 'print':
        await call(as, 'POST', `${path}/print`, { kind: action.kind });
    }
  };

  const restamp = async (since: Date, at: Date) => {
    for (const model of RESTAMPED) {
      await (db[model] as unknown as { updateMany(args: unknown): Promise<unknown> }).updateMany({ where: { createdAt: { gte: since } }, data: { createdAt: at } });
    }
  };

  return {
    async runDay(offset: number, openedAt: Date, closesAt: Date) {
      const back = days.indexOf(offset);
      if (back < 0) return;
      const steps = ORDERS.flatMap((order) => order.steps.filter((step) => step[0] === back).map((step) => ({ key: order.key, step })));
      steps.sort((a, b) => a.step[1] - b.step[1]);
      cookies = new Map();
      const span = Math.max(closesAt.getTime() - openedAt.getTime() - 60 * MINUTE, MINUTE);
      for (const { key, step } of steps) {
        const [, fraction, as, action] = step;
        const at = new Date(openedAt.getTime() + 30 * MINUTE + Math.round(fraction * span));
        clock.set(at);
        const since = new Date();
        await perform(key, as, action, at);
        await restamp(since, at);
      }
    },
    async close() {
      await app.close();
    },
  };
}
