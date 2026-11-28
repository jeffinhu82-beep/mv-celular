import { formatMoney, parseDayKey, STORE_TIME_ZONE } from '@loja/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartPoint } from '@/lib/types.ts';
import { cn } from '@/lib/utils.ts';

const BAR_COLOR = 'var(--primary)';
const compactMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const weekdayDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: STORE_TIME_ZONE });

type Granularity = 'hour' | 'day';

interface ChartRow extends ChartPoint {
  tick: string;
  title: string;
}

function visiblePoints(points: ChartPoint[], granularity: Granularity): ChartPoint[] {
  if (granularity === 'day') return points;
  const active = points.flatMap((point, index) => (point.salesCents > 0 || point.receivedCents !== 0 ? [index] : []));
  const first = Math.min(8, active[0] ?? 8);
  const last = Math.max(18, active.at(-1) ?? 18);
  return points.slice(first, last + 1);
}

function toRows(points: ChartPoint[], granularity: Granularity): ChartRow[] {
  const sameMonth = new Set(points.map((point) => point.key.slice(0, 7))).size <= 1;
  return visiblePoints(points, granularity).map((point) => {
    if (granularity === 'hour') {
      const hour = Number(point.key);
      return { ...point, tick: `${hour}h`, title: `${hour}h às ${hour + 1}h` };
    }
    const [, month, day] = point.key.split('-');
    return { ...point, tick: sameMonth ? day! : `${day}/${month}`, title: weekdayDate.format(parseDayKey(point.key)).replace('.', '') };
  });
}

function salesLabel(count: number) {
  return count === 1 ? '1 venda' : `${count} vendas`;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartRow }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-md border border-border bg-surface-3 px-3 py-2 text-xs shadow-lg">
      <p className="num text-sm font-semibold">{formatMoney(row.salesCents)}</p>
      <p className="text-muted">{salesLabel(row.salesCount)}</p>
      <p className="mt-1 text-muted">{row.title}</p>
    </div>
  );
}

export function SalesChart({ points, granularity, className }: { points: ChartPoint[]; granularity: Granularity; className?: string }) {
  const rows = toRows(points, granularity);
  const empty = rows.every((row) => row.salesCents === 0);
  return (
    <div className="relative flex flex-1 flex-col">
      <div className={cn('h-52 sm:h-56', className ?? 'xl:h-auto xl:min-h-52 xl:flex-1')} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%" accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="tick"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              hide={empty}
              axisLine={false}
              tickLine={false}
              width={64}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              tickFormatter={(value: number) => compactMoney.format(value / 100)}
              allowDecimals={false}
            />
            <Tooltip cursor={{ fill: 'var(--surface-2)', stroke: 'none' }} content={(props) => <ChartTooltip active={props.active} payload={props.payload as ReadonlyArray<{ payload?: ChartRow }>} />} isAnimationActive={false} />
            <Bar dataKey="salesCents" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">Nenhuma venda concluída no período.</p>}
      <table className="sr-only">
        <caption>Vendas por {granularity === 'hour' ? 'hora' : 'dia'}</caption>
        <thead>
          <tr>
            <th scope="col">{granularity === 'hour' ? 'Hora' : 'Dia'}</th>
            <th scope="col">Vendas</th>
            <th scope="col">Total vendido</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((row) => row.salesCount > 0)
            .map((row) => (
              <tr key={row.key}>
                <td>{row.title}</td>
                <td>{row.salesCount}</td>
                <td>{formatMoney(row.salesCents)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
