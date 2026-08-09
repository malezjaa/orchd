import {
  Ban,
  Brain,
  ClipboardCheck,
  Flame,
  Gauge,
  Hammer,
  Paperclip,
  ShieldCheck,
  ShieldQuestion,
  Sparkle,
  Sparkles,
} from "lucide-react"
import type {
  PromptContextUsage,
  PromptModelOption,
  PromptOption,
} from "@/components/agents/prompt-input"
import { PromptInput } from "@/components/agents/prompt-input"
import type {
  AgentMode,
  ModelInfo,
  PolicyRule,
  ThinkingEffort,
} from "@/lib/orchd"
import {
  agentLabel,
  formatContextSize,
  MODEL_PROVIDER_ICON,
  MODEL_PROVIDER_LABEL,
} from "@/lib/orchd"

export interface SessionComposerProps {
  agentKind: string
  loading: boolean
  disabled?: boolean
  onStop: () => void
  onSubmit: (value: string) => void
  // Seeds the model picker's initial selection.
  currentModel?: string | null
  // Empty or omitted hides the model picker, as in the draft composer
  // before there's a live socket to send commands on.
  models?: ModelInfo[]
  onModelChange?: (model: string) => void
  onThinkingChange?: (effort: ThinkingEffort) => void
  onModeChange?: (mode: AgentMode) => void
  onPermissionPreset?: (rules: PolicyRule[]) => void
  contextUsage?: PromptContextUsage | null
}

const MODES: PromptOption[] = [
  {
    value: "build",
    label: "Build mode",
    icon: <Hammer />,
    description: "Make changes directly as it goes",
  },
  {
    value: "plan",
    label: "Plan mode",
    icon: <ClipboardCheck />,
    description: "Research and propose a plan, no changes yet",
  },
]

// What the agent may do without asking, orthogonal to `MODES` above.
// Each preset is sent as an `update_policy` rule list.
const PERMISSION_MODES: PromptOption[] = [
  {
    value: "default",
    label: "Default",
    icon: <ShieldQuestion />,
    description: "Ask before writes, edits, or shell commands",
  },
  {
    value: "accept_edits",
    label: "Accept edits",
    icon: <ShieldCheck />,
    description: "Auto-approve file writes, still ask for shell/network",
  },
  {
    value: "bypass",
    label: "Bypass permissions",
    icon: <Ban />,
    description: "Run everything without asking (use with care)",
  },
]

// Claude Code's own `--effort` vocabulary: exactly these five values,
// verified against the installed CLI (2.1.224).
const THINKING_LEVELS: PromptOption[] = [
  { value: "low", label: "Low", icon: <Sparkle /> },
  { value: "medium", label: "Medium", icon: <Sparkles /> },
  { value: "high", label: "High", icon: <Brain /> },
  { value: "xhigh", label: "Extra high", icon: <Gauge /> },
  { value: "max", label: "Max", icon: <Flame /> },
]

const PERMISSION_PRESET_RULES: Record<string, PolicyRule[]> = {
  default: [],
  accept_edits: [{ action: "allow", kind: "file_write", pattern: null }],
  bypass: [
    { action: "allow", kind: "file_write", pattern: null },
    { action: "allow", kind: "shell_exec", pattern: null },
    { action: "allow", kind: "network_access", pattern: null },
    { action: "allow", kind: "tool_use", pattern: null },
    { action: "allow", kind: "custom", pattern: null },
  ],
}

// PromptInput owns and clears its own text, so callers must pass a
// `key={session.id}` or switching sessions carries stale text over.
export function SessionComposer({
  agentKind,
  loading,
  disabled,
  onStop,
  onSubmit,
  currentModel,
  models = [],
  onModelChange,
  onThinkingChange,
  onModeChange,
  onPermissionPreset,
  contextUsage,
}: SessionComposerProps) {
  const modelOptions: PromptModelOption[] = models.map((model) => {
    const ProviderIcon = MODEL_PROVIDER_ICON[model.provider]
    return {
      value: model.id,
      label: model.display_name,
      description: `${formatContextSize(model.context_window)} context`,
      provider: model.provider,
      providerLabel: MODEL_PROVIDER_LABEL[model.provider],
      providerIcon: <ProviderIcon />,
    }
  })

  return (
    <div className="shrink-0 p-3">
      <div className="mx-auto max-w-3xl">
        <PromptInput
          loading={loading}
          disabled={disabled}
          onStop={onStop}
          onSubmit={onSubmit}
          minRows={2}
          maxRows={8}
          placeholder={
            disabled
              ? "This session is closed"
              : `Message ${agentLabel(agentKind)}… @ to reference files, / for commands`
          }
          actions={[
            { value: "attach", label: "Attach file", icon: <Paperclip /> },
          ]}
          models={onModelChange ? modelOptions : []}
          defaultModel={currentModel ?? undefined}
          onModelChange={onModelChange}
          modes={onModeChange ? MODES : []}
          defaultMode="build"
          onModeChange={(mode) => onModeChange?.(mode as AgentMode)}
          permissionModes={onPermissionPreset ? PERMISSION_MODES : []}
          defaultPermissionMode="default"
          onPermissionModeChange={(value) =>
            onPermissionPreset?.(PERMISSION_PRESET_RULES[value] ?? [])
          }
          thinkingLevels={onThinkingChange ? THINKING_LEVELS : []}
          onThinkingLevelChange={(level) =>
            onThinkingChange?.(level as ThinkingEffort)
          }
          contextUsage={contextUsage}
        />
      </div>
    </div>
  )
}
