import { useSearchParams } from 'react-router';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { DefaultsTab } from './defaults-tab.tsx';
import { FeesTab } from './fees-tab.tsx';
import { KanbanTab } from './kanban-tab.tsx';
import { PrintTab } from './print-tab.tsx';
import { StoreTab } from './store-tab.tsx';

const TABS = [
  { value: 'loja', label: 'Loja', render: () => <StoreTab /> },
  { value: 'taxas', label: 'Taxas', render: () => <FeesTab /> },
  { value: 'kanban', label: 'Kanban e mensagens', render: () => <KanbanTab /> },
  { value: 'impressao', label: 'Impressão', render: () => <PrintTab /> },
  { value: 'padroes', label: 'Padrões', render: () => <DefaultsTab /> },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((item) => item.value === params.get('aba'))?.value ?? 'loja';
  return (
    <>
      <PageHeader title="Configurações" description="Dados da loja, taxas das maquininhas, quadro de OS, impressão e padrões." />
      <Tabs value={tab} onValueChange={(value) => setParams({ aba: value }, { replace: true })}>
        <TabsList className="max-w-full relative overflow-x-auto">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((item) => (
          <TabsContent key={item.value} value={item.value}>
            {item.render()}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
