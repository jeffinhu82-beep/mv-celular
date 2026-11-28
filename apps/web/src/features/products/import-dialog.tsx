import { parseMoneyInput } from '@loja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { api, errorMessage } from '@/lib/api.ts';
import { downloadText, parseCsv, toCsv } from '@/lib/csv.ts';
import { useToast } from '@/lib/toast.tsx';

const COLUMNS = ['nome', 'tipo', 'sku', 'codigo_barras', 'custo', 'preco', 'estoque_minimo', 'estoque_inicial'];

interface ParsedRow {
  type: 'product' | 'service';
  name: string;
  sku: string | null;
  barcode: string | null;
  costCents: number;
  priceCents: number;
  minStock: number;
  tracksStock: boolean;
  initialStock: number;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

function readMoney(value: string): number | null {
  if (!/\d/.test(value)) return null;
  const cents = parseMoneyInput(value);
  return cents < 0 ? null : cents;
}

function parseRows(text: string): { rows: ParsedRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], errors: ['O arquivo precisa ter o cabeçalho e pelo menos uma linha.'] };
  const header = table[0]!.map(normalizeHeader);
  const index = (name: string) => header.indexOf(name);
  if (index('nome') < 0 || index('preco') < 0) return { rows: [], errors: ['O cabeçalho precisa ter pelo menos as colunas "nome" e "preco".'] };
  const rows: ParsedRow[] = [];
  table.slice(1).forEach((cells, position) => {
    const line = position + 2;
    const cell = (name: string) => (index(name) >= 0 ? (cells[index(name)] ?? '').trim() : '');
    const name = cell('nome');
    if (!name) return errors.push(`Linha ${line}: nome vazio.`);
    const type = /servi/i.test(cell('tipo')) ? 'service' : 'product';
    const price = readMoney(cell('preco'));
    if (price === null) return errors.push(`Linha ${line}: preço inválido.`);
    const cost = cell('custo') ? readMoney(cell('custo')) : 0;
    if (cost === null) return errors.push(`Linha ${line}: custo inválido.`);
    const minStock = Number(cell('estoque_minimo') || 0);
    const initialStock = Number(cell('estoque_inicial') || 0);
    if (!Number.isInteger(minStock) || minStock < 0 || !Number.isInteger(initialStock) || initialStock < 0) {
      return errors.push(`Linha ${line}: estoque precisa ser um número inteiro.`);
    }
    rows.push({
      type,
      name,
      sku: cell('sku') || null,
      barcode: cell('codigo_barras') || null,
      costCents: cost,
      priceCents: price,
      minStock,
      tracksStock: type === 'product',
      initialStock,
    });
  });
  return { rows, errors };
}

export function ImportProductsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<{ rows: ParsedRow[]; errors: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = (value: boolean) => {
    if (!value) {
      setParsed(null);
      setFileName('');
    }
    onOpenChange(value);
  };

  const submit = async () => {
    if (!parsed?.rows.length) return;
    setSaving(true);
    try {
      const result = await api.post<{ created: number }>('/api/products/import', { rows: parsed.rows });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      toast.success(`${result.created} itens importados`);
      reset(false);
    } catch (error) {
      toast.error('Importação não concluída', `${errorMessage(error)} Nada foi gravado.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent
        title="Importar produtos (CSV)"
        description="Use ponto e vírgula ou vírgula como separador. A importação é tudo ou nada: se uma linha falhar, nada é gravado."
        footer={
          <>
            <Button variant="ghost" onClick={() => reset(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={!parsed?.rows.length || parsed.errors.length > 0} loading={saving} onClick={submit}>
              Importar {parsed?.rows.length ? `${parsed.rows.length} itens` : ''}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Button
            variant="link"
            className="self-start px-0"
            onClick={() =>
              downloadText(
                'modelo-produtos.csv',
                toCsv(COLUMNS, [
                  ['Película 3D iPhone 13', 'produto', 'PEL-IP13-B', '7891234567890', '8,00', '39,90', '5', '20'],
                  ['Limpeza interna', 'serviço', '', '', '', '60,00', '', ''],
                ]),
              )
            }
          >
            Baixar modelo de planilha
          </Button>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted hover:border-primary/60">
            <FileUp className="size-6" />
            {fileName || 'Escolher arquivo .csv'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setParsed(parseRows(await file.text()));
              }}
            />
          </label>
          {parsed && (
            <div className="text-sm">
              {parsed.errors.length > 0 ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-warning">
                  <p className="font-medium">Corrija o arquivo antes de importar:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {parsed.errors.slice(0, 8).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                  {parsed.errors.length > 8 && <p className="mt-1">e mais {parsed.errors.length - 8} problemas.</p>}
                </div>
              ) : (
                <p className="text-success">{parsed.rows.length} linhas prontas para importar.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
