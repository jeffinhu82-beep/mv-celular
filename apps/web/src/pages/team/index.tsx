import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc.tsx';
import { useSearchState } from '@/lib/hooks.ts';
import { PerformanceTab } from './performance-tab.tsx';
import { RolesTab } from './roles-tab.tsx';
import { UsersTab } from './users-tab.tsx';

function readTab(value: string | null) {
  return value === 'perfis' || value === 'desempenho' ? value : 'usuarios';
}

export function TeamPage() {
  const [params, update] = useSearchState();
  const tab = readTab(params.get('aba'));
  return (
    <>
      <PageHeader title="Equipe" description="Usuários, perfis, o que cada perfil pode fazer e o desempenho de cada pessoa." />
      <Tabs value={tab} onValueChange={(value) => update({ aba: value === 'usuarios' ? null : value })}>
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="perfis">Perfis e permissões</TabsTrigger>
          <TabsTrigger value="desempenho">Desempenho</TabsTrigger>
        </TabsList>
        <TabsContent value="usuarios">
          <UsersTab />
        </TabsContent>
        <TabsContent value="perfis">
          <RolesTab />
        </TabsContent>
        <TabsContent value="desempenho">{tab === 'desempenho' && <PerformanceTab params={params} update={update} />}</TabsContent>
      </Tabs>
    </>
  );
}
