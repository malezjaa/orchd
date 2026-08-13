import {
  Activity,
  Coins,
  Gauge,
  Hourglass,
  MessagesSquare,
  Timer,
  Wrench,
} from "lucide-react"
import { useMemo, type ReactNode } from "react"
import type { ModelInfo, SessionContext } from "@/lib/orchd"
import { formatDuration } from "@/lib/format-duration"
import { formatContextSize as formatTokens } from "@/lib/orchd"
import type { SessionTimelineState } from "@/lib/session-timeline"
import { groupTimelineByTurn, turnDurationSeconds } from "@/lib/timeline-groups"
import { cn } from "@/lib/utils"
import { useElapsedSeconds } from "@/lib/hooks/use-elapsed-seconds"

interface RunInsightsPanelProps {
  state: SessionTimelineState
  context: SessionContext | null
  model?: ModelInfo
}

function MetricRow({
  icon: Icon,
  label,
  value,
  muted = false,
}: {
  icon: typeof Gauge
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 py-2">
      <Icon
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 text-right font-mono text-[11px] tabular-nums",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <p className="mb-2 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </section>
  )
}

function formatCost(cost: number | null): string {
  return cost === null ? "Not reported" : `$${cost.toFixed(4)}`
}

export function RunInsightsPanel({
  state,
  context,
  model,
}: RunInsightsPanelProps) {
  const elapsedSeconds = useElapsedSeconds(
    state.turnStartedAt ? Date.parse(state.turnStartedAt) : undefined
  )
  const lastTurnDuration = useMemo(() => {
    if (state.busy) return undefined
    const groups = groupTimelineByTurn(state.events)
    return groups.length > 0
      ? turnDurationSeconds(groups[groups.length - 1])
      : undefined
  }, [state.busy, state.events])

  const usedTokens = state.usage
    ? state.usage.input_tokens +
      state.usage.cache_creation_input_tokens +
      state.usage.cache_read_input_tokens
    : (context?.used_tokens ?? null)
  const contextWindow = model?.context_window ?? context?.context_window ?? null
  const percent =
    usedTokens !== null && contextWindow
      ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
      : null
  const contextTone =
    percent !== null && percent >= 85
      ? "bg-rose-500"
      : percent !== null && percent >= 60
        ? "bg-amber-500"
        : "bg-primary"
  const turnCount = state.events.filter(
    (event) => event.kind === "user_message"
  ).length
  const toolCount = state.events.filter(
    (event) => event.kind === "tool_result"
  ).length

  return (
    <div className="min-h-0 overflow-y-auto">
      <Section title="Context">
        {usedTokens !== null && contextWindow !== null ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-xl font-medium tracking-tight text-foreground">
                  {formatTokens(usedTokens)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  of {formatTokens(contextWindow)} tokens
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {percent}%
              </span>
            </div>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Context window used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  contextTone
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {formatTokens(Math.max(0, contextWindow - usedTokens))}{" "}
                remaining
              </span>
              <span>{model?.display_name ?? "Current model"}</span>
            </div>
            {state.usage ? (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border/70 pt-3">
                <MetricRow
                  icon={Gauge}
                  label="Input"
                  value={formatTokens(state.usage.input_tokens)}
                />
                <MetricRow
                  icon={Gauge}
                  label="Output"
                  value={formatTokens(state.usage.output_tokens)}
                />
                <MetricRow
                  icon={Gauge}
                  label="Cache read"
                  value={formatTokens(state.usage.cache_read_input_tokens)}
                />
                <MetricRow
                  icon={Gauge}
                  label="Cache write"
                  value={formatTokens(state.usage.cache_creation_input_tokens)}
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Context usage will appear after the first model response.
          </p>
        )}
      </Section>

      <Section title="Cost">
        <div className="divide-y divide-border/70">
          <MetricRow
            icon={Coins}
            label="Latest turn"
            value={formatCost(state.usage?.cost_usd ?? null)}
            muted={state.usage?.cost_usd === null || !state.usage}
          />
          <MetricRow
            icon={Coins}
            label="Session total"
            value={formatCost(state.insights.sessionCostUsd)}
            muted={state.insights.sessionCostUsd === null}
          />
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Costs are reported by the connected adapter.
        </p>
      </Section>

      <Section title="Timing">
        <div className="divide-y divide-border/70">
          <MetricRow
            icon={Timer}
            label="Current turn"
            value={state.busy ? formatDuration(elapsedSeconds) : "Idle"}
            muted={!state.busy}
          />
          <MetricRow
            icon={Hourglass}
            label="Last turn"
            value={
              lastTurnDuration === undefined
                ? "Not available"
                : formatDuration(lastTurnDuration)
            }
            muted={lastTurnDuration === undefined}
          />
          <MetricRow
            icon={Wrench}
            label="Longest tool"
            value={
              state.insights.longestTool
                ? `${state.insights.longestTool.name} · ${formatDuration(state.insights.longestTool.durationSeconds)}`
                : "Not measured"
            }
            muted={!state.insights.longestTool}
          />
        </div>
      </Section>

      <Section title="Activity">
        <div className="divide-y divide-border/70">
          <MetricRow
            icon={MessagesSquare}
            label="Turns"
            value={String(turnCount)}
          />
          <MetricRow
            icon={Wrench}
            label="Tool calls"
            value={String(toolCount)}
          />
          <MetricRow
            icon={Activity}
            label="Status"
            value={state.busy ? "Working" : "Waiting"}
            muted={!state.busy}
          />
        </div>
      </Section>
    </div>
  )
}
