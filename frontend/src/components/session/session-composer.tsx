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
  Zap,
} from "lucide-react"
import { useEffect, useState } from "react"
import type {
  PromptContextUsage,
  PromptModelOption,
  PromptOption,
} from "@/components/agents/prompt-input"
import { PromptInput } from "@/components/agents/prompt-input"
import type {
  AgentMode,
  AgentSkill,
  ContentPart,
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
  onSubmit: (value: string, content?: ContentPart[]) => void
  // Seeds the model picker's initial selection.
  currentModel?: string | null
  // Seeds the reasoning tier for a draft session from application settings.
  currentEffort?: ThinkingEffort | null
  currentFastMode?: boolean | null
  // Empty or omitted hides the model picker, as in the draft composer
  // before there's a live socket to send commands on.
  models?: ModelInfo[]
  onModelChange?: (model: string) => void
  onThinkingChange?: (effort: ThinkingEffort) => void
  onFastModeChange?: (fastMode: boolean) => void
  onModeChange?: (mode: AgentMode) => void
  onPermissionPreset?: (rules: PolicyRule[]) => void
  contextUsage?: PromptContextUsage | null
  filePaths?: readonly string[]
  skills?: readonly AgentSkill[]
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

const FALLBACK_CLAUDE_EFFORTS: ThinkingEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]
const FALLBACK_CODEX_EFFORTS: ThinkingEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
]

const REASONING_LABELS: Record<ThinkingEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
}

function reasoningIcon(effort: ThinkingEffort) {
  switch (effort) {
    case "low":
      return <Sparkle />
    case "medium":
      return <Sparkles />
    case "high":
      return <Brain />
    case "xhigh":
      return <Gauge />
    case "max":
      return <Flame />
    case "ultra":
      return <Zap />
  }
}

function reasoningOptions(
  model: ModelInfo | undefined,
  agentKind: string
): PromptOption[] {
  const efforts = model?.supported_reasoning_efforts.length
    ? model.supported_reasoning_efforts
    : agentKind === "codex"
      ? FALLBACK_CODEX_EFFORTS
      : FALLBACK_CLAUDE_EFFORTS

  return efforts.map((effort) => ({
    value: effort,
    label: REASONING_LABELS[effort],
    icon: reasoningIcon(effort),
  }))
}

const SPEED_MODES: PromptOption[] = [
  {
    value: "standard",
    label: "Standard",
    icon: <Gauge />,
    description: "Normal response speed",
  },
  {
    value: "fast",
    label: "Fast",
    icon: <Zap />,
    description: "1.5x speed with higher credit use",
  },
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
  currentEffort,
  currentFastMode,
  models = [],
  onModelChange,
  onThinkingChange,
  onFastModeChange,
  onModeChange,
  onPermissionPreset,
  contextUsage,
  filePaths,
  skills = [],
}: SessionComposerProps) {
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    currentModel ?? undefined
  )
  const [selectedEffort, setSelectedEffort] = useState<
    ThinkingEffort | undefined
  >(currentEffort ?? undefined)
  const [selectedFastMode, setSelectedFastMode] = useState(
    currentFastMode ?? false
  )

  useEffect(() => {
    setSelectedModel(currentModel ?? undefined)
  }, [currentModel])

  useEffect(() => {
    setSelectedEffort(currentEffort ?? undefined)
  }, [currentEffort])

  useEffect(() => {
    setSelectedFastMode(currentFastMode ?? false)
  }, [currentFastMode])

  const provider = agentKind === "codex" ? "open_ai" : "anthropic"
  const modelOptions: PromptModelOption[] = models
    .filter((model) => model.provider === provider)
    .map((model) => {
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
  const selectedModelId = selectedModel ?? modelOptions[0]?.value
  const selectedModelInfo = models.find((model) => model.id === selectedModelId)
  const thinkingOptions = reasoningOptions(selectedModelInfo, agentKind)
  const defaultEffort =
    selectedModelInfo?.default_reasoning_effort ??
    (thinkingOptions[0]?.value as ThinkingEffort | undefined)
  const effectiveEffort =
    selectedEffort &&
    thinkingOptions.some((option) => option.value === selectedEffort)
      ? selectedEffort
      : defaultEffort
  const fastModeAvailable =
    agentKind === "codex" && selectedModelInfo?.supports_fast_mode === true

  const handleModelChange = (model: string) => {
    setSelectedModel(model)
    onModelChange?.(model)

    const nextModel = models.find((candidate) => candidate.id === model)
    const nextThinkingOptions = reasoningOptions(nextModel, agentKind)
    const nextDefaultEffort =
      nextModel?.default_reasoning_effort ??
      (nextThinkingOptions[0]?.value as ThinkingEffort | undefined)
    const nextEffort =
      selectedEffort &&
      nextThinkingOptions.some((option) => option.value === selectedEffort)
        ? selectedEffort
        : nextDefaultEffort

    if (nextEffort) {
      setSelectedEffort(nextEffort)
      onThinkingChange?.(nextEffort)
    }

    if (nextModel?.supports_fast_mode !== true && selectedFastMode) {
      setSelectedFastMode(false)
      onFastModeChange?.(false)
    }
  }

  const handleFastModeChange = (mode: string) => {
    const fastMode = mode === "fast"
    setSelectedFastMode(fastMode)
    onFastModeChange?.(fastMode)
  }

  return (
    <div className="shrink-0 p-3">
      <div className="mx-auto max-w-3xl">
        <PromptInput
          loading={loading}
          disabled={disabled}
          onStop={onStop}
          onSubmit={(value, _model, content) => onSubmit(value, content)}
          minRows={2}
          maxRows={8}
          placeholder={
            disabled
              ? "This session is closed"
              : `Message ${agentLabel(agentKind)}… paste images, @ files, / commands`
          }
          actions={[
            { value: "attach", label: "Attach image", icon: <Paperclip /> },
          ]}
          models={onModelChange ? modelOptions : []}
          model={selectedModelId}
          onModelChange={handleModelChange}
          modes={onModeChange ? MODES : []}
          defaultMode="build"
          onModeChange={(mode) => onModeChange?.(mode as AgentMode)}
          permissionModes={onPermissionPreset ? PERMISSION_MODES : []}
          defaultPermissionMode="default"
          onPermissionModeChange={(value) =>
            onPermissionPreset?.(PERMISSION_PRESET_RULES[value] ?? [])
          }
          speedModes={fastModeAvailable && onFastModeChange ? SPEED_MODES : []}
          speedMode={selectedFastMode ? "fast" : "standard"}
          defaultSpeedMode="standard"
          onSpeedModeChange={handleFastModeChange}
          thinkingLevels={onThinkingChange ? thinkingOptions : []}
          thinkingLevel={effectiveEffort}
          onThinkingLevelChange={(level) => {
            const effort = level as ThinkingEffort
            setSelectedEffort(effort)
            onThinkingChange?.(effort)
          }}
          contextUsage={contextUsage}
          filePaths={filePaths}
          skills={skills}
        />
      </div>
    </div>
  )
}
