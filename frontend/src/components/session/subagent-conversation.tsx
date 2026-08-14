import { Bot, CircleStop, RefreshCw } from "lucide-react"
import { AgentMarkdown } from "@/components/agents/agent-markdown"
import { SessionComposer } from "@/components/session/session-composer"
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
import type { SubagentMessage } from "@/lib/session-timeline"
import type { AgentSkill, ContentPart, SubagentRecord } from "@/lib/orchd"
import { subagentLabel } from "@/lib/subagent"

interface SubagentConversationProps {
  agent: SubagentRecord
  messages: SubagentMessage[]
  agentKind: string
  filePaths?: readonly string[]
  skills?: readonly AgentSkill[]
  onSend: (threadId: string, text: string, content?: ContentPart[]) => void
  onInterrupt: (threadId: string) => void
  onInspect: (threadId: string) => void
  onSubagentOpen?: (threadId: string) => void
}

export function SubagentConversation({
  agent,
  messages,
  agentKind,
  filePaths,
  skills,
  onSend,
  onInterrupt,
  onInspect,
  onSubagentOpen,
}: SubagentConversationProps) {
  const name = subagentLabel(agent)
  const canSend =
    agent.can_accept_direct_input !== false &&
    agent.status !== "not_found" &&
    agent.status !== "shutdown"
  const canInterrupt = agent.status === "running"
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
      {agent.prompt ? (
        <div className="border-b border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <p className="mb-1 text-[10px] font-medium tracking-[0.12em] uppercase">
            Initial task
          </p>
          <AgentMarkdown
            className="line-clamp-3"
            onSubagentOpen={onSubagentOpen}
          >
            {agent.prompt}
          </AgentMarkdown>
        </div>
      ) : null}

      <MessageScroller
        className="min-h-0 flex-1"
        viewportClassName="px-4 py-5"
        contentClassName="mx-auto w-full max-w-2xl"
      >
        <MessageGroup spacing="default" className="gap-3">
          {visibleMessages.map((message) => (
            <Message key={message.id} from={message.role} animateIn>
              <MessageContent className="max-w-[88%]">
                {message.role === "user" ? (
                  <MessageBubble variant="soft">
                    <MessageBubbleContent>{message.text}</MessageBubbleContent>
                  </MessageBubble>
                ) : (
                  <AgentMarkdown onSubagentOpen={onSubagentOpen}>
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
        placeholder={
          canSend ? `Message ${name}…` : "Child thread is unavailable"
        }
      />
    </div>
  )
}
