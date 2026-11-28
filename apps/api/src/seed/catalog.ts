import type { Db } from '../db.ts';

interface ProductSeed {
  name: string;
  category: string;
  sku: string;
  barcode?: string;
  costCents: number;
  priceCents: number;
  stockQty: number;
  minStock: number;
}

export const CATEGORIES = ['Películas', 'Capas', 'Carregadores e cabos', 'Fones e áudio', 'Telas', 'Baterias', 'Conectores e flex', 'Acessórios'];

export const PRODUCTS: ProductSeed[] = [
  { name: 'Película 3D iPhone 13/14', category: 'Películas', sku: 'PEL-IP13', barcode: '7891000100013', costCents: 450, priceCents: 3000, stockQty: 40, minStock: 10 },
  { name: 'Película 3D Galaxy A54', category: 'Películas', sku: 'PEL-A54', barcode: '7891000100020', costCents: 400, priceCents: 2500, stockQty: 25, minStock: 10 },
  { name: 'Película de privacidade iPhone 15', category: 'Películas', sku: 'PEL-IP15P', barcode: '7891000100037', costCents: 900, priceCents: 4500, stockQty: 6, minStock: 8 },
  { name: 'Película hidrogel universal', category: 'Películas', sku: 'PEL-HIDRO', barcode: '7891000100044', costCents: 300, priceCents: 3500, stockQty: 60, minStock: 15 },
  { name: 'Capa anti-impacto iPhone 13', category: 'Capas', sku: 'CAP-IP13', barcode: '7891000200011', costCents: 1200, priceCents: 4990, stockQty: 18, minStock: 5 },
  { name: 'Capa silicone Galaxy S23', category: 'Capas', sku: 'CAP-S23', barcode: '7891000200028', costCents: 900, priceCents: 3990, stockQty: 12, minStock: 5 },
  { name: 'Capa carteira Moto G84', category: 'Capas', sku: 'CAP-G84', barcode: '7891000200035', costCents: 1100, priceCents: 4490, stockQty: 3, minStock: 4 },
  { name: 'Carregador turbo USB-C 25W', category: 'Carregadores e cabos', sku: 'CAR-25W', barcode: '7891000300018', costCents: 2800, priceCents: 7990, stockQty: 15, minStock: 5 },
  { name: 'Carregador 20W compatível iPhone', category: 'Carregadores e cabos', sku: 'CAR-20W', barcode: '7891000300025', costCents: 2500, priceCents: 6990, stockQty: 20, minStock: 5 },
  { name: 'Cabo USB-C para USB-C 1 m', category: 'Carregadores e cabos', sku: 'CAB-CC1', barcode: '7891000300032', costCents: 800, priceCents: 2990, stockQty: 35, minStock: 10 },
  { name: 'Cabo Lightning 1 m', category: 'Carregadores e cabos', sku: 'CAB-LTG1', barcode: '7891000300049', costCents: 900, priceCents: 3490, stockQty: 28, minStock: 10 },
  { name: 'Carregador veicular duplo', category: 'Carregadores e cabos', sku: 'CAR-VEIC', barcode: '7891000300056', costCents: 1500, priceCents: 4990, stockQty: 8, minStock: 3 },
  { name: 'Fone Bluetooth TWS', category: 'Fones e áudio', sku: 'FON-TWS', barcode: '7891000400015', costCents: 4500, priceCents: 12990, stockQty: 10, minStock: 3 },
  { name: 'Fone com fio P2', category: 'Fones e áudio', sku: 'FON-P2', barcode: '7891000400022', costCents: 700, priceCents: 2490, stockQty: 22, minStock: 5 },
  { name: 'Caixa de som Bluetooth mini', category: 'Fones e áudio', sku: 'CXS-MINI', barcode: '7891000400039', costCents: 3500, priceCents: 9990, stockQty: 4, minStock: 2 },
  { name: 'Tela iPhone 11 (incell)', category: 'Telas', sku: 'TEL-IP11', costCents: 9000, priceCents: 0, stockQty: 4, minStock: 2 },
  { name: 'Tela iPhone 13 (OLED)', category: 'Telas', sku: 'TEL-IP13', costCents: 32000, priceCents: 0, stockQty: 2, minStock: 1 },
  { name: 'Tela Galaxy A32 com aro', category: 'Telas', sku: 'TEL-A32', costCents: 13000, priceCents: 0, stockQty: 3, minStock: 2 },
  { name: 'Tela Moto G60', category: 'Telas', sku: 'TEL-G60', costCents: 8000, priceCents: 15000, stockQty: 5, minStock: 2 },
  { name: 'Bateria iPhone 11', category: 'Baterias', sku: 'BAT-IP11', costCents: 6000, priceCents: 0, stockQty: 6, minStock: 3 },
  { name: 'Bateria Galaxy A10', category: 'Baterias', sku: 'BAT-A10', costCents: 3500, priceCents: 0, stockQty: 1, minStock: 2 },
  { name: 'Bateria Moto G8 Power', category: 'Baterias', sku: 'BAT-G8P', costCents: 4000, priceCents: 0, stockQty: 4, minStock: 2 },
  { name: 'Conector de carga Galaxy A20', category: 'Conectores e flex', sku: 'CON-A20', costCents: 1500, priceCents: 0, stockQty: 7, minStock: 3 },
  { name: 'Flex de carga iPhone 8', category: 'Conectores e flex', sku: 'FLX-IP8', costCents: 2500, priceCents: 0, stockQty: 2, minStock: 2 },
  { name: 'Suporte veicular magnético', category: 'Acessórios', sku: 'ACE-SUPM', barcode: '7891000500012', costCents: 1300, priceCents: 3990, stockQty: 9, minStock: 3 },
  { name: 'Cartão de memória 64 GB', category: 'Acessórios', sku: 'ACE-SD64', barcode: '7891000500029', costCents: 2800, priceCents: 6990, stockQty: 7, minStock: 2 },
];

export const SERVICES = [
  { name: 'Troca de tela', priceCents: 15000, estimatedMinutes: 90 },
  { name: 'Troca de bateria', priceCents: 8000, estimatedMinutes: 40 },
  { name: 'Troca de conector de carga', priceCents: 9000, estimatedMinutes: 60 },
  { name: 'Limpeza de oxidação', priceCents: 12000, estimatedMinutes: 120 },
  { name: 'Backup e formatação', priceCents: 7000, estimatedMinutes: 60 },
  { name: 'Diagnóstico técnico', priceCents: 5000, estimatedMinutes: 30 },
  { name: 'Aplicação de película', priceCents: 1000, estimatedMinutes: 10 },
  { name: 'Desbloqueio de conta / configuração', priceCents: 6000, estimatedMinutes: 45 },
];

export const CUSTOMERS = [
  { name: 'Mariana Alves', phone: '+5548991234567', cpf: '52998224725', email: 'mariana.alves@email.com', address: 'Rua Bocaiúva, 120 - Centro' },
  { name: 'João Pedro Silva', phone: '+5548988776655' },
  { name: 'Fernanda Costa', phone: '+5548996541230', email: 'fe.costa@email.com' },
  { name: 'Ricardo Oliveira', phone: '+5548984443322', address: 'Av. Beira-Mar Norte, 2000 - Agronômica' },
  { name: 'Patrícia Gomes', phone: '+5548999887766' },
  { name: 'Lucas Martins', phone: '+5548991112233', notes: 'Prefere contato à tarde.' },
  { name: 'Juliana Pereira', phone: '+5548992223344' },
  { name: 'Eduardo Santos', phone: '+5548993334455', cpf: '15350946056' },
  { name: 'Camila Rocha', phone: '+5548994445566' },
  { name: 'Thiago Barbosa', phone: '+5548995556677', notes: 'Cliente empresa, pede recibo.' },
  { name: 'Aline Ferreira', phone: '+5548996667788' },
  { name: 'Gustavo Ribeiro', phone: '+5548997778899' },
];

export async function seedCatalog(db: Db, createdById: string) {
  const categories = new Map<string, string>();
  for (const name of CATEGORIES) {
    categories.set(name, (await db.category.create({ data: { name } })).id);
  }
  const products = new Map<string, string>();
  for (const product of PRODUCTS) {
    const created = await db.product.create({
      data: {
        type: 'product',
        name: product.name,
        sku: product.sku,
        barcode: product.barcode ?? null,
        categoryId: categories.get(product.category)!,
        costCents: product.costCents,
        priceCents: product.priceCents,
        stockQty: product.stockQty,
        minStock: product.minStock,
        tracksStock: true,
        createdById,
      },
    });
    await db.stockMovement.create({
      data: {
        productId: created.id,
        type: 'purchase',
        qty: product.stockQty,
        unitCostCents: product.costCents,
        balanceAfter: product.stockQty,
        supplier: 'Estoque inicial',
        userId: createdById,
      },
    });
    products.set(product.sku, created.id);
  }
  const services = new Map<string, string>();
  for (const service of SERVICES) {
    const created = await db.product.create({
      data: { type: 'service', name: service.name, priceCents: service.priceCents, estimatedMinutes: service.estimatedMinutes, tracksStock: false, createdById },
    });
    services.set(service.name, created.id);
  }
  const customers = new Map<string, string>();
  for (const customer of CUSTOMERS) {
    const created = await db.customer.create({
      data: {
        name: customer.name,
        phoneE164: customer.phone,
        cpf: customer.cpf ?? null,
        email: customer.email ?? null,
        address: customer.address ?? null,
        notes: customer.notes ?? null,
        createdById,
      },
    });
    customers.set(customer.name, created.id);
  }
  return { categories, products, services, customers };
}
