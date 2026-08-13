import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  buildAttendanceStats,
  buildControlSeries,
  buildPlanVsActualSeries,
  buildValidationStats,
} from "@/lib/operational-widgets";
import type { Column, Row, WidgetType } from "@/lib/types";
import { cn } from "@/lib/utils";

type OperationalWidgetType = Extract<
  WidgetType,
  "attendance-overview" | "validation-overview" | "control-chart" | "plan-vs-actual"
>;

const chartTooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 11,
};

function SummaryStrip({
  items,
}: {
  items: Array<{ label: string; value: string | number; tone?: string }>;
}) {
  return (
    <div className="grid grid-cols-2 border-b border-border bg-muted/10 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 border-r border-border/60 px-4 py-3 last:border-r-0"
        >
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </p>
          <p className={cn("mt-1 font-mono text-xl font-bold tabular-nums", item.tone)}>
            {typeof item.value === "number" ? item.value.toLocaleString("pt-BR") : item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function EmptyOperationalWidget({ message }: { message: string }) {
  return <p className="p-8 text-center text-xs text-muted-foreground">{message}</p>;
}

function AttendanceBody({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const stats = buildAttendanceStats(columns, rows);
  const max = Math.max(1, ...stats.bySector.map((item) => item.value));
  return (
    <>
      <SummaryStrip
        items={[
          { label: "Participantes", value: stats.total },
          {
            label: "Assinaturas",
            value: stats.signed,
            tone: "text-emerald-700 dark:text-emerald-300",
          },
          {
            label: "Assinaturas ausentes",
            value: stats.missingSignatures,
            tone: stats.missingSignatures ? "text-destructive" : "text-muted-foreground",
          },
          {
            label: "Completude",
            value: `${stats.completion}%`,
            tone:
              stats.completion >= 90
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-700 dark:text-amber-300",
          },
        ]}
      />
      {!stats.total ? (
        <EmptyOperationalWidget message="Nenhum participante preenchido nesta visualização." />
      ) : (
        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(12rem,1fr)]">
          <section aria-label="Participantes por setor">
            <h3 className="mb-3 text-xs font-semibold">Participantes por setor</h3>
            <div className="space-y-2.5">
              {stats.bySector.slice(0, 10).map((item) => (
                <div
                  key={item.label}
                  className="grid grid-cols-[minmax(7rem,1fr)_3fr_auto] items-center gap-2 text-xs"
                >
                  <span className="truncate" title={item.label}>
                    {item.label}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono font-semibold tabular-nums">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section
            aria-label="Participantes por turno"
            className="border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"
          >
            <h3 className="mb-3 text-xs font-semibold">Distribuição por turno</h3>
            <div className="flex flex-wrap gap-2">
              {stats.byShift.slice(0, 8).map((item) => (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs"
                >
                  {item.label}
                  <strong className="font-mono tabular-nums">{item.value}</strong>
                </span>
              ))}
              {!stats.byShift.length && (
                <span className="text-xs text-muted-foreground">Sem coluna de turno.</span>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ValidationBody({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const stats = buildValidationStats(columns, rows);
  return (
    <>
      <SummaryStrip
        items={[
          { label: "Validações", value: stats.total },
          {
            label: "Aprovadas",
            value: stats.approved,
            tone: "text-emerald-700 dark:text-emerald-300",
          },
          {
            label: "Rejeitadas",
            value: stats.rejected,
            tone: stats.rejected ? "text-destructive" : "text-muted-foreground",
          },
          { label: "Taxa de aprovação", value: `${stats.approvalRate}%` },
        ]}
      />
      {!stats.total ? (
        <EmptyOperationalWidget message="Nenhuma validação preenchida nesta visualização." />
      ) : (
        <div className="max-h-80 overflow-auto p-3">
          <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Inspetor</th>
                <th className="px-3 py-2 text-right">Aprovadas</th>
                <th className="px-3 py-2 text-right">Rejeitadas</th>
                <th className="px-3 py-2 text-right">Pendentes</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {stats.byInspector.map((item) => {
                const total = item.approved + item.rejected + item.pending;
                const risk = item.rejected > 0 || item.pending > 0;
                return (
                  <tr key={item.label} className="bg-muted/25">
                    <th className="rounded-l-xl px-3 py-2.5 text-left font-medium">{item.label}</th>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-300">
                      {item.approved}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-destructive">
                      {item.rejected}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-700 dark:text-amber-300">
                      {item.pending}
                    </td>
                    <td className="rounded-r-xl px-3 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[10px] font-semibold",
                          risk
                            ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                            : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                        )}
                      >
                        {risk
                          ? `${item.rejected + item.pending} para revisar`
                          : `${total} conformes`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ControlChartBody({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const series = buildControlSeries(columns, rows);
  if (!series.metric || !series.points.length) {
    return (
      <EmptyOperationalWidget message="Não encontrei uma medição numérica suficiente para a carta de controle." />
    );
  }
  return (
    <>
      <SummaryStrip
        items={[
          { label: "Medição", value: series.metric.label },
          {
            label: "Média",
            value: series.mean.toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
          },
          {
            label: "Limite inferior",
            value: series.lower.toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
          },
          {
            label: "Fora de controle",
            value: series.outside,
            tone: series.outside ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
          },
        ]}
      />
      <div className="h-72 min-w-0 p-4" aria-label={`Carta de controle de ${series.metric.label}`}>
        <ResponsiveContainer>
          <LineChart data={series.points} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
            <YAxis tick={{ fontSize: 10 }} width={56} domain={["auto", "auto"]} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Line
              type="monotone"
              dataKey="upper"
              name="Limite superior"
              stroke="var(--destructive)"
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="mean"
              name="Média"
              stroke="var(--muted-foreground)"
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="lower"
              name="Limite inferior"
              stroke="var(--destructive)"
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={series.metric.label}
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "var(--primary)" }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        Limites estatísticos automáticos de ±3 desvios-padrão. Confirme os limites de especificação
        do processo antes de tomar decisões.
      </p>
    </>
  );
}

function PlanVsActualBody({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const series = buildPlanVsActualSeries(columns, rows);
  if (!series.length) {
    return (
      <EmptyOperationalWidget message="Não encontrei pares de colunas Programado e Realizado para o mesmo período." />
    );
  }
  const planned = series.reduce((sum, item) => sum + item.planned, 0);
  const actual = series.reduce((sum, item) => sum + item.actual, 0);
  const attainment = planned ? actual / planned : null;
  const belowPlan = series.filter((item) => item.actual < item.planned).length;
  return (
    <>
      <SummaryStrip
        items={[
          {
            label: "Programado",
            value: planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
          },
          {
            label: "Realizado",
            value: actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
          },
          {
            label: "Atendimento",
            value:
              attainment === null
                ? "—"
                : attainment.toLocaleString("pt-BR", {
                    style: "percent",
                    maximumFractionDigits: 1,
                  }),
            tone:
              attainment !== null && attainment >= 1
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-700 dark:text-amber-300",
          },
          {
            label: "Períodos abaixo",
            value: belowPlan,
            tone: belowPlan ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
          },
        ]}
      />
      <div
        className="h-72 min-w-0 p-4"
        aria-label="Comparação entre produção programada e realizada"
      >
        <ResponsiveContainer>
          <BarChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={18} />
            <YAxis tick={{ fontSize: 10 }} width={56} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Bar
              dataKey="planned"
              name="Programado"
              fill="var(--muted-foreground)"
              radius={[5, 5, 0, 0]}
            />
            <Bar dataKey="actual" name="Realizado" fill="var(--primary)" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export function OperationalWidgetBody({
  type,
  columns,
  rows,
}: {
  type: OperationalWidgetType;
  columns: Column[];
  rows: Row[];
}) {
  if (type === "attendance-overview") return <AttendanceBody columns={columns} rows={rows} />;
  if (type === "validation-overview") return <ValidationBody columns={columns} rows={rows} />;
  if (type === "control-chart") return <ControlChartBody columns={columns} rows={rows} />;
  return <PlanVsActualBody columns={columns} rows={rows} />;
}
