import type { PrintSize } from '@loja/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useStoreSettings } from '@/components/layout/app-shell.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { Skeleton } from '@/components/ui/misc.tsx';
import { PaperPreview, PrintPortal, PrintSizePicker, printNow } from '@/features/print/print.tsx';
import { api } from '@/lib/api.ts';
import type { CashSessionView } from '@/lib/types.ts';
import { CashReport } from './report.tsx';

export function useCashSession(id: string | null) {
  return useQuery({ queryKey: ['cash', 'session', id], queryFn: () => api.get<CashSessionView>(`/api/cash/sessions/${id}`), enabled: Boolean(id) });
}

export function CashReportDialog({ sessionId, onOpenChange, actions }: { sessionId: string | null; onOpenChange(open: boolean): void; actions?: ReactNode }) {
  const settings = useStoreSettings();
  const session = useCashSession(sessionId);
  const [size, setSize] = useState<PrintSize>('A4');
  useEffect(() => {
    if (settings.data) setSize(settings.data.printDefaultSize);
  }, [settings.data]);
  return (
    <Dialog open={Boolean(sessionId)} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title="Relatório de caixa"
        description="Resumo do caixa com o esperado, o contado e todas as movimentações."
        footer={
          <>
            {actions}
            <Button variant="primary" onClick={() => printNow(size)} disabled={!session.data}>
              <Printer /> Imprimir
            </Button>
          </>
        }
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Papel</span>
          <PrintSizePicker value={size} onChange={setSize} />
        </div>
        {session.data ? (
          <>
            <PaperPreview size={size}>
              <CashReport session={session.data} settings={settings.data} size={size} />
            </PaperPreview>
            <PrintPortal>
              <CashReport session={session.data} settings={settings.data} size={size} />
            </PrintPortal>
          </>
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}
