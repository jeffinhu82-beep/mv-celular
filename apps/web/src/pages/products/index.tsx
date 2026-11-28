import { useSearchParams } from 'react-router';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { useAuth } from '@/lib/auth.tsx';
import { CategoriesTab } from './categories-tab.tsx';
import { MovementsTab } from './movements-tab.tsx';
import { ProductsTab } from './products-tab.tsx';

const TABS = ['produtos', 'servicos', 'movimentacoes', 'categorias'] as const;
type Tab = (typeof TABS)[number];

export function ProductsPage() {
  const { canAny } = useAuth();
  const [params, setParams] = useSearchParams();
  const showMovements = canAny(['stock.manage', 'product.manage']);
  const requested = params.get('aba') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== 'movimentacoes' || showMovements) ? requested : 'produtos';

  const setTab = (value: string) => {
    const next = new URLSearchParams();
    next.set('aba', value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Produtos e estoque" description="Produtos, peças, serviços e o histórico de cada movimentação." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="servicos">Serviços</TabsTrigger>
          {showMovements && <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>}
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
        </TabsList>
        <TabsContent value="produtos">
          <ProductsTab type="product" />
        </TabsContent>
        <TabsContent value="servicos">
          <ProductsTab type="service" />
        </TabsContent>
        {showMovements && (
          <TabsContent value="movimentacoes">
            <MovementsTab productId={params.get('produto')} onClearProduct={() => setTab('movimentacoes')} />
          </TabsContent>
        )}
        <TabsContent value="categorias">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
