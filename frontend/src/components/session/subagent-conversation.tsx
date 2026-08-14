import { RefreshCw, Square } from "lucide-react"
import { AgentMarkdown } from "@/components/agents/agent-markdown"
import { SessionComposer } from "@/components/session/session-composer"
import { Button } from "@/components/ui/button"
import {
  Message,
  MessageContent,
  MessageGroup,
  MessageScroller,
} from "@/components/agents/message"
import {
  MessageBubble,
  MessageBubbleContent,
} from "@/components/agents/message-bubble"
import { MessageFooterStrip } from "@/components/agents/message-footer-strip"
import type { SubagentMessage } from "@/lib/session-timeline"
import type { AgentSkill, ContentPart, SubagentRecord } from "@/lib/orchd"
import type { PermissionEvent } from "@/lib/timeline"
import { cn } from "@/lib/utils"
import {
  subagentLabel,
  subagentStatusIcon,
  subagentStatusLabel,
  subagentTone,
} from "@/lib/subagent"

interface SubagentConversationProps {
  agent: SubagentRecord
  messages: SubagentMessage[]
  agentKind: string
  filePaths?: readonly string[]
  skills?: readonly AgentSkill[]
  onFileOpen?: (path: string) => void
  subagents?: readonly Pick<SubagentRecord, "thread_id" | "status">[]
  onSend: (threadId: string, text: string, content?: ContentPart[]) => void
  onInterrupt: (threadId: string) => void
  onInspect: (threadId: string) => void
  onSubagentOpen?: (threadId: string) => void
  pendingApprovals?: PermissionEvent[]
  onApproval?: (id: string) => void
  onAlwaysAllowApproval?: (id: string) => void
  onDenyApproval?: (id: string) => void
}

export function SubagentConversation({
  agent,
  messages,
  agentKind,
  filePaths,
  skills,
  onFileOpen,
  subagents,
  onSend,
  onInterrupt,
  onInspect,
  onSubagentOpen,
  pendingApprovals,
  onApproval,
  onAlwaysAllowApproval,
  onDenyApproval,
}: SubagentConversationProps) {
  const name = subagentLabel(agent)
  const canSend =
    agent.can_accept_direct_input !== false &&
    agent.status !== "not_found" &&
    agent.status !== "shutdown"
  const canInterrupt = agent.status === "running"
  const statusLabel = subagentStatusLabel(agent.status)
  const StatusIcon = subagentStatusIcon(agent.status)
  const visibleMessages =
    messages.length > 0
      ? messages
      : agent.summary
        ? [
            {
              id: `${agent.thread_id}:summary`,
              role: "assistant" as const,
              text: agent.summary,
              ts: agent.updated_at,
            },
          ]
        : []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="status"
        aria-live={canInterrupt ? "polite" : undefined}
        className="shrink-0 border-b border-border/70 bg-gradient-to-b from-muted/25 to-transparent px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full",
              subagentTone(agent.status)
            )}
          >
            <StatusIcon
              className={cn(
                "size-3.5",
                agent.status === "running" &&
                  "motion-safe:animate-[spin_2.5s_linear_infinite] motion-reduce:animate-none"
              )}
              aria-hidden="true"
            />
          </span>
          <p className="shrink-0 text-xs font-medium text-foreground">
            {statusLabel}
          </p>
          {canInterrupt ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onInterrupt(agent.thread_id)}
              className="ml-auto shrink-0 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Square className="size-3 fill-current" aria-hidden="true" />
              Stop
            </Button>
          ) : null}
          {agent.status === "errored" || agent.status === "not_found" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title={`Refresh ${name} status`}
              aria-label={`Refresh ${name} status`}
              onClick={() => onInspect(agent.thread_id)}
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {agent.prompt ? (
          <div className="mt-3 border-l-2 border-primary/45 pl-3 text-xs text-muted-foreground">
            <p className="mb-1 text-[10px] font-medium tracking-[0.12em] uppercase">
              Initial task
            </p>
            <AgentMarkdown
              className="line-clamp-3 text-sm leading-5"
              onFileOpen={onFileOpen}
              onSubagentOpen={onSubagentOpen}
              subagents={subagents}
            >
              {agent.prompt}
            </AgentMarkdown>
          </div>
        ) : null}
      </div>

      <MessageScroller
        className="min-h-0 flex-1"
        viewportClassName="px-4 py-5"
        contentClassName="mx-auto w-full max-w-2xl"
      >
        <MessageGroup spacing="default" className="gap-2">
          {visibleMessages.map((message) => (
            <Message key={message.id} from={message.role} animateIn>
              <MessageContent>
                {message.role === "user" ? (
                  <>
                    <MessageBubble variant="soft">
                      <MessageBubbleContent>
                        <AgentMarkdown
                          onFileOpen={onFileOpen}
                          onSubagentOpen={onSubagentOpen}
                          subagents={subagents}
                        >
                          {message.text}
                        </AgentMarkdown>
                      </MessageBubbleContent>
                    </MessageBubble>
                    <MessageFooterStrip
                      copyText={message.text}
                      timestamp={message.ts}
                      align="end"
                    />
                  </>
                ) : (
                  <AgentMarkdown
                    onFileOpen={onFileOpen}
                    onSubagentOpen={onSubagentOpen}
                    subagents={subagents}
                  >
                    {message.text}
                  </AgentMarkdown>
                )}
              </MessageContent>
            </Message>
          ))}
          {visibleMessages.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              No child response has been recorded yet.
            </p>
          ) : null}
        </MessageGroup>
      </MessageScroller>

      <SessionComposer
        key={agent.thread_id}
        agentKind={agentKind}
        loading={false}
        disabled={!canSend}
        onStop={() => onInterrupt(agent.thread_id)}
        onSubmit={(text, content) => onSend(agent.thread_id, text, content)}
        filePaths={filePaths}
        skills={skills}
        pendingApprovals={pendingApprovals}
        onApproval={onApproval}
        onAlwaysAllowApproval={onAlwaysAllowApproval}
        onDenyApproval={onDenyApproval}
        placeholder={
          canSend ? `Message ${name}…` : "Child thread is unavailable"
        }
      />
    </div>
  )
}
