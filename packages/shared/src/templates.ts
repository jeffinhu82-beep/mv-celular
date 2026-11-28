export const TEMPLATE_VARIABLES = [
  { key: 'cliente', label: 'Nome completo do cliente' },
  { key: 'primeiro_nome', label: 'Primeiro nome do cliente' },
  { key: 'numero_os', label: 'Número da OS' },
  { key: 'aparelho', label: 'Aparelho (marca e modelo)' },
  { key: 'defeito', label: 'Defeito relatado' },
  { key: 'valor_total', label: 'Valor total do orçamento' },
  { key: 'valor_restante', label: 'Valor que falta pagar' },
  { key: 'previsao', label: 'Previsão de entrega' },
  { key: 'garantia_dias', label: 'Dias de garantia' },
  { key: 'loja', label: 'Nome da loja' },
  { key: 'telefone_loja', label: 'Telefone da loja' },
  { key: 'endereco_loja', label: 'Endereço da loja' },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]['key'];
export type TemplateValues = Partial<Record<TemplateVariable, string>>;

export function renderTemplate(body: string, values: Record<string, string | undefined>): string {
  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : value;
  });
}

export const SAMPLE_TEMPLATE_VALUES: TemplateValues = {
  cliente: 'Maria Souza',
  primeiro_nome: 'Maria',
  numero_os: 'OS-000045',
  aparelho: 'Samsung Galaxy A54',
  defeito: 'Tela quebrada',
  valor_total: 'R$ 450,00',
  valor_restante: 'R$ 400,00',
  previsao: '28/11/2026',
  garantia_dias: '90',
  loja: 'Loja Exemplo',
  telefone_loja: '(48) 99999-9999',
  endereco_loja: 'Rua das Flores, 100 - Centro',
};

export const DEFAULT_TEMPLATES = {
  received:
    'Olá, {primeiro_nome}! Recebemos seu {aparelho}. O número da sua OS é {numero_os}. Avisaremos assim que o orçamento ficar pronto. {loja}',
  quoteSent:
    'Olá, {primeiro_nome}! O orçamento do seu {aparelho} (OS {numero_os}) ficou em {valor_total}. Podemos seguir com o conserto?',
  ready:
    'Olá, {primeiro_nome}! Seu {aparelho} está pronto para retirada. Valor a pagar: {valor_restante}. Endereço: {endereco_loja}. {loja}',
  delivered:
    'Obrigado pela preferência, {primeiro_nome}! Seu serviço tem garantia de {garantia_dias} dias. Qualquer coisa, é só chamar aqui.',
  saleQuote:
    'Olá, {primeiro_nome}! Segue o orçamento {numero}: {itens} Total: {total}. Válido até {validade}. {loja}',
  saleReceipt: 'Olá, {primeiro_nome}! Obrigado pela compra na {loja}. Comprovante {numero}: {itens} Total: {total}.',
} as const;
