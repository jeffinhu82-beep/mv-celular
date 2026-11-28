import { PeriodPicker, periodQuery, readPeriod } from '@/components/filters/period-picker.tsx';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { FinanceReportTab } from '@/features/reports/finance-tab.tsx';
import { SoldItemsReportTab } from '@/features/reports/items-tab.tsx';
import { SalesReportTab } from '@/features/reports/sales-tab.tsx';
import { ServiceOrdersReportTab } from '@/features/reports/service-orders-tab.tsx';
import { useSearchState } from '@/lib/hooks.ts';

const TABS = { sales: null, items: 'itens', os: 'os', finance: 'financeiro' } as const;
type Tab = keyof typeof TABS;

function readTab(value: string | null): Tab {
  if (value === 'itens') return 'items';
  if (value === 'os') return 'os';
  if (value === 'financeiro') return 'finance';
  return 'sales';
}

export function ReportsPage() {
  const [params, update] = useSearchState();
  const period = readPeriod(params, 'month');
  const tab = readTab(params.get('aba'));

  return (
    <div>
      <PageHeader title="Relatórios" description="Vendas, itens vendidos, ordens de serviço e financeiro do período. Cada tabela exporta em CSV." actions={<PeriodPicker value={period} onChange={(value) => update({ from: null, to: null, ...periodQuery(value) })} />} />
      <Tabs value={tab} onValueChange={(value) => update({ aba: TABS[value as Tab] })}>
        <TabsList>
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="items">Itens vendidos</TabsTrigger>
          <TabsTrigger value="os">Ordens de serviço</TabsTrigger>
          <TabsTrigger value="finance">Financeiro</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">{tab === 'sales' && <SalesReportTab period={period} />}</TabsContent>
        <TabsContent value="items">{tab === 'items' && <SoldItemsReportTab period={period} />}</TabsContent>
        <TabsContent value="os">{tab === 'os' && <ServiceOrdersReportTab period={period} />}</TabsContent>
        <TabsContent value="finance">{tab === 'finance' && <FinanceReportTab period={period} />}</TabsContent>
      </Tabs>
    </div>
  );
}
