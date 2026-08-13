"use client"

import { Node, mergeAttributes, type Editor } from "@tiptap/core"
import { Markdown } from "@tiptap/markdown"
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  useEditor,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  CornerDownLeft,
  FileCode2,
  Sparkles,
} from "lucide-react"
import {
  type KeyboardEvent,
  type MouseEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { getFileIcon } from "@/lib/file-icon.tsx"
import { searchFiles, type RankedFile } from "@/lib/file-search"
import type { AgentSkill, ContentPart } from "@/lib/orchd"
import {
  promptContentFromMarkdown,
  promptTextFromContent,
} from "@/lib/prompt-content"
import { cn } from "@/lib/utils"
import { ImageMention } from "@/components/agents/image-mention"
import { SkillMention } from "@/components/agents/skill-mention"

interface FileTrigger {
  from: number
  to: number
  query: string
}

interface SkillTrigger {
  from: number
  to: number
  query: string
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function findFileTrigger(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const match = /(?:^|[\s([{])@([^\s]*)$/.exec(value.slice(0, cursor))
  if (!match || !/^[\w./-]*$/.test(match[1])) return null

  return {
    start: cursor - match[1].length - 1,
    query: match[1],
  }
}

function getFileTrigger(editor: Editor | null): FileTrigger | null {
  if (!editor || !editor.isFocused) return null
  const selection = editor.state.selection
  if (!selection.empty) return null

  const textBefore = editor.state.doc.textBetween(
    0,
    selection.from,
    "\n",
    "\ufffc"
  )
  const trigger = findFileTrigger(textBefore, textBefore.length)
  if (!trigger) return null

  return {
    from: selection.from - (textBefore.length - trigger.start),
    to: selection.from,
    query: trigger.query,
  }
}

function findSkillTrigger(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const match = /(?:^|[\s([{])\/([^\s]*)$/.exec(value.slice(0, cursor))
  if (!match || !/^[\w-]*$/.test(match[1])) return null
  return { start: cursor - match[1].length - 1, query: match[1] }
}

function getSkillTrigger(editor: Editor | null): SkillTrigger | null {
  if (!editor || !editor.isFocused) return null
  const selection = editor.state.selection
  if (!selection.empty) return null
  const textBefore = editor.state.doc.textBetween(
    0,
    selection.from,
    "\n",
    "\ufffc"
  )
  const trigger = findSkillTrigger(textBefore, textBefore.length)
  if (!trigger) return null
  return {
    from: selection.from - (textBefore.length - trigger.start),
    to: selection.from,
    query: trigger.query,
  }
}

const FileMentionNode = Node.create({
  name: "fileMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      path: {
        default: "",
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-file-mention]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-file-mention": "",
        "data-path": node.attrs.path,
      }),
      `@${node.attrs.path}`,
    ]
  },

  renderText({ node }) {
    return `@${node.attrs.path}`
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("fileMention", { path: token.path ?? "" })
  },

  markdownTokenizer: {
    name: "fileMention",
    level: "inline" as const,
    start(source: string) {
      const match = /(?:^|[\s([{])@([\w./-]+)/.exec(source)
      return match ? match.index + match[0].length - match[1].length : -1
    },
    tokenize(source: string) {
      const match = /^@([\w./-]+)/.exec(source)
      if (!match) return undefined
      return {
        type: "fileMention",
        raw: match[0],
        path: match[1],
      }
    },
  },

  renderMarkdown(node) {
    return `@${node.attrs?.path ?? ""}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileMentionView)
  },
})

const SkillMentionNode = Node.create({
  name: "skillMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      name: { default: "" },
      path: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-skill-mention]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-skill-mention": "",
        "data-skill-name": node.attrs.name,
      }),
      `/${node.attrs.name}`,
    ]
  },

  renderText({ node }) {
    return `/${node.attrs.name}`
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("skillMention", {
      name: token.name ?? "",
    })
  },

  markdownTokenizer: {
    name: "skillMention",
    level: "inline" as const,
    start(source: string) {
      const match = /(?:^|[\s([{])\/([A-Za-z0-9][\w-]*)(?![\w/-])/.exec(source)
      return match ? match.index + match[0].length - match[1].length : -1
    },
    tokenize(source: string) {
      const match = /^\/([A-Za-z0-9][\w-]*)(?![\w/-])/.exec(source)
      if (!match) return undefined
      return { type: "skillMention", raw: match[0], name: match[1] }
    },
  },

  renderMarkdown(node) {
    return `/${node.attrs?.name ?? ""}`
  },

  addNodeView() {
    return ReactNodeViewRenderer(SkillMentionView)
  },
})

const ImageMentionNode = Node.create({
  name: "imageMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      mediaType: { default: "image/png" },
      data: { default: "" },
      name: { default: "image" },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-image-mention]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-image-mention": "",
        "data-image-name": node.attrs.name,
      }),
      `[${node.attrs.name}]`,
    ]
  },

  renderText({ node }) {
    return `[${node.attrs.name}]`
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode("imageMention", {
      mediaType: token.mediaType ?? "image/png",
      data: token.data ?? "",
      name: token.name ?? "image",
    })
  },

  markdownTokenizer: {
    name: "imageMention",
    level: "inline" as const,
    start(source: string) {
      const match = /(?:^|[\s([{])(!\[[^\]]*\]\(data:[^)]+\))/.exec(source)
      return match ? match.index + match[0].length - match[1].length : -1
    },
    tokenize(source: string) {
      const match = /^!\[([^\]]*)\]\(data:([^;]+);base64,([^)]*)\)/.exec(
        source
      )
      if (!match) return undefined
      return {
        type: "imageMention",
        raw: match[0],
        name: match[1] || "image",
        mediaType: match[2],
        data: match[3],
      }
    },
  },

  renderMarkdown(node) {
    const name = String(node.attrs?.name ?? "image").replaceAll("]", "\\]")
    const mediaType = String(node.attrs?.mediaType ?? "image/png")
    const data = String(node.attrs?.data ?? "")
    return `![${name}](data:${mediaType};base64,${data})`
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageMentionView)
  },
})

function FileMentionView({ node }: NodeViewProps) {
  const path = String(node.attrs.path ?? "")
  const Icon = getFileIcon(path)
  const label = path.split("/").filter(Boolean).pop() || path

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      title={path}
      className="not-typeset mx-0.5 inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border border-foreground/20 bg-muted/60 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-none text-foreground/90 dark:border-foreground/25"
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </NodeViewWrapper>
  )
}

function useScrollActiveItem(activeIndex: number) {
  const activeItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  return activeItemRef
}

function SkillMentionView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <SkillMention name={String(node.attrs.name ?? "")} />
    </NodeViewWrapper>
  )
}

function ImageMentionView({ node }: NodeViewProps) {
  const name = String(node.attrs.name ?? "image")
  const mediaType = String(node.attrs.mediaType ?? "image/png")
  const data = String(node.attrs.data ?? "")
  const src = data ? `data:${mediaType};base64,${data}` : undefined

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <ImageMention src={src ?? ""} name={name} />
    </NodeViewWrapper>
  )
}

function FileSearchMenu({
  results,
  activeIndex,
  onSelect,
}: {
  results: RankedFile[]
  activeIndex: number
  onSelect: (path: string) => void
}) {
  const activeItemRef = useScrollActiveItem(activeIndex)

  return (
    <div
      className="absolute inset-x-0 bottom-[calc(100%-0.25rem)] z-20 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5"
      role="listbox"
      aria-label="Files"
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <FileCode2 className="size-3" />
        <span>Reference a file</span>
        <span className="ml-auto font-mono text-[10px] opacity-70">
          ↑↓ navigate · ↵ select
        </span>
      </div>
      {results.length ? (
        <div className="max-h-56 overflow-y-auto p-1">
          {results.map((result, index) => {
            const fileName = result.path.split("/").pop() ?? result.path
            const parent = result.path.includes("/")
              ? result.path.slice(0, result.path.lastIndexOf("/"))
              : "Project root"
            const Icon = getFileIcon(result.path)

            return (
              <button
                key={result.path}
                ref={index === activeIndex ? activeItemRef : undefined}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                title={result.path}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(result.path)
                }}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors outline-none",
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-foreground">
                    {fileName}
                  </span>
                  <span className="ml-1.5 truncate text-[11px] text-muted-foreground">
                    {parent}
                  </span>
                </span>
                {index === activeIndex ? (
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="px-3 py-5 text-center text-xs text-muted-foreground">
          No matching files
        </div>
      )}
    </div>
  )
}

function SkillSearchMenu({
  results,
  activeIndex,
  onSelect,
}: {
  results: AgentSkill[]
  activeIndex: number
  onSelect: (skill: AgentSkill) => void
}) {
  const activeItemRef = useScrollActiveItem(activeIndex)

  return (
    <div
      className="absolute inset-x-0 bottom-[calc(100%-0.25rem)] z-20 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5"
      role="listbox"
      aria-label="Skills"
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="size-3 text-sky-500" />
        <span>Invoke a skill</span>
        <span className="ml-auto font-mono text-[10px] opacity-70">
          ↑↓ navigate · ↵ select
        </span>
      </div>
      {results.length ? (
        <div className="max-h-56 overflow-y-auto p-1">
          {results.map((skill, index) => (
            <button
              key={skill.name}
              ref={index === activeIndex ? activeItemRef : undefined}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(skill)
              }}
              className={cn(
                "group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors outline-none",
                index === activeIndex
                  ? "bg-sky-500/10 text-foreground"
                  : "hover:bg-muted"
              )}
            >
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-foreground">
                  /{skill.name}
                </span>
                {skill.description ? (
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {skill.description}
                  </span>
                ) : null}
              </span>
              {index === activeIndex ? (
                <CornerDownLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-5 text-center text-xs text-muted-foreground">
          No matching skills
        </div>
      )}
    </div>
  )
}

export interface PromptEditorProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (content: ContentPart[], promptText: string) => void
  onContentChange?: (content: ContentPart[]) => void
  imagePickerRequest?: number
  onImageError?: (message: string) => void
  filePaths: readonly string[]
  skills: readonly AgentSkill[]
  minRows: number
  maxRows: number
  placeholder: string
  ariaLabel: string
  disabled?: boolean
}

export function PromptEditor({
  value,
  onValueChange,
  onSubmit,
  filePaths,
  skills,
  minRows,
  maxRows,
  placeholder,
  ariaLabel,
  disabled = false,
  onContentChange,
  imagePickerRequest = 0,
  onImageError,
}: PromptEditorProps) {
  const onValueChangeRef = useRef(onValueChange)
  const [, setEditorVersion] = useState(0)
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const [dismissedFileTrigger, setDismissedFileTrigger] = useState<
    string | null
  >(null)
  const [dismissedSkillTrigger, setDismissedSkillTrigger] = useState<
    string | null
  >(null)
  const editorRef = useRef<Editor | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const lastImagePickerRequest = useRef(imagePickerRequest)
  const onContentChangeRef = useRef(onContentChange)
  const onImageErrorRef = useRef(onImageError)

  onValueChangeRef.current = onValueChange
  onContentChangeRef.current = onContentChange
  onImageErrorRef.current = onImageError

  const imageDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result)
        else reject(new Error(`could not read ${file.name}`))
      }
      reader.onerror = () => reject(new Error(`could not read ${file.name}`))
      reader.readAsDataURL(file)
    })

  const insertImages = async (files: File[]) => {
    const editor = editorRef.current
    if (!editor || disabled) return
    const imageFiles = files.filter((file) => file.type.startsWith("image/"))
    if (!imageFiles.length) return
    const position = editor.state.selection.from
    const nodes = []
    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_BYTES) {
        onImageErrorRef.current?.(`${file.name} is larger than 10 MB`)
        continue
      }
      try {
        const dataUrl = await imageDataUrl(file)
        const comma = dataUrl.indexOf(",")
        if (comma === -1) throw new Error("image data is invalid")
        nodes.push(
          {
            type: "imageMention",
            attrs: {
              mediaType: file.type,
              data: dataUrl.slice(comma + 1),
              name: file.name || "image",
            },
          },
          { type: "text", text: " " }
        )
      } catch {
        onImageErrorRef.current?.(`Could not read ${file.name}`)
      }
    }
    if (nodes.length) editor.chain().focus().insertContentAt(position, nodes).run()
  }

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        FileMentionNode,
        SkillMentionNode,
        ImageMentionNode,
        Markdown,
      ],
      content: value,
      contentType: "markdown",
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": ariaLabel,
          "aria-multiline": "true",
          autocapitalize: "off",
          autocorrect: "off",
          class:
            "prompt-editor-content outline-none ring-0 focus:outline-none focus:ring-0",
          role: "textbox",
          spellcheck: "false",
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.items ?? [])
            .filter(
              (item) =>
                item.kind === "file" && item.type.startsWith("image/")
            )
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null)
          if (!files.length) return false
          event.preventDefault()
          void insertImages(files)
          return true
        },
      },
    },
    []
  )

  useEffect(() => {
    if (!editor) return

    const refresh = () => setEditorVersion((version) => version + 1)
    const updateValue = () => {
      const content = promptContentFromEditor(editor, skills)
      onValueChangeRef.current(editor.getMarkdown())
      onContentChangeRef.current?.(content)
      refresh()
    }

    editor.on("update", updateValue)
    editor.on("selectionUpdate", refresh)
    return () => {
      editor.off("update", updateValue)
      editor.off("selectionUpdate", refresh)
    }
  }, [editor, skills])

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor])

  useEffect(() => {
    if (imagePickerRequest === lastImagePickerRequest.current) return
    lastImagePickerRequest.current = imagePickerRequest
    imageInputRef.current?.click()
  }, [imagePickerRequest])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return
    editor.commands.setContent(value, { contentType: "markdown" })
  }, [editor, value])

  const focusEditorFromPadding = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || disabled) return

    const editorElement = editor.view.dom
    const clickedPadding =
      event.target === event.currentTarget ||
      event.target === editorElement.parentElement
    if (!clickedPadding) return

    event.preventDefault()
    editor.chain().focus("end").run()
  }

  const fileTrigger = getFileTrigger(editor)
  const deferredFileQuery = useDeferredValue(fileTrigger?.query ?? "")
  const fileResults = useMemo(
    () => searchFiles(filePaths, deferredFileQuery),
    [deferredFileQuery, filePaths]
  )
  const fileTriggerKey = fileTrigger
    ? `${fileTrigger.from}:${fileTrigger.query}`
    : null
  const fileMenuOpen =
    fileTrigger !== null && dismissedFileTrigger !== fileTriggerKey
  const skillTrigger = getSkillTrigger(editor)
  const deferredSkillQuery = useDeferredValue(skillTrigger?.query ?? "")
  const skillResults = useMemo(() => {
    const query = deferredSkillQuery.trim().toLowerCase()
    return skills.filter(
      (skill) =>
        !query ||
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query)
    )
  }, [deferredSkillQuery, skills])
  const skillTriggerKey = skillTrigger
    ? `${skillTrigger.from}:${skillTrigger.query}`
    : null
  const skillMenuOpen =
    skillTrigger !== null && dismissedSkillTrigger !== skillTriggerKey

  useEffect(() => {
    setActiveFileIndex((index) =>
      fileResults.length ? Math.min(index, fileResults.length - 1) : 0
    )
  }, [fileResults.length])

  useEffect(() => {
    setActiveFileIndex(0)
    setDismissedFileTrigger(null)
  }, [fileTriggerKey])

  useEffect(() => {
    setActiveSkillIndex((index) =>
      skillResults.length ? Math.min(index, skillResults.length - 1) : 0
    )
  }, [skillResults.length])

  useEffect(() => {
    setActiveSkillIndex(0)
    setDismissedSkillTrigger(null)
  }, [skillTriggerKey])

  const selectFile = (path: string) => {
    if (!editor || !fileTrigger) return

    editor
      .chain()
      .focus()
      .deleteRange({ from: fileTrigger.from, to: fileTrigger.to })
      .insertContent([
        { type: "fileMention", attrs: { path } },
        { type: "text", text: " " },
      ])
      .run()
  }

  const selectSkill = (skill: AgentSkill) => {
    if (!editor || !skillTrigger) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: skillTrigger.from, to: skillTrigger.to })
      .insertContent([
        {
          type: "skillMention",
          attrs: { name: skill.name, path: skill.path },
        },
        { type: "text", text: " " },
      ])
      .run()
  }

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (skillMenuOpen && event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setActiveSkillIndex((index) =>
        skillResults.length ? (index + 1) % skillResults.length : 0
      )
      return
    }
    if (skillMenuOpen && event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setActiveSkillIndex((index) =>
        skillResults.length
          ? (index - 1 + skillResults.length) % skillResults.length
          : 0
      )
      return
    }
    if (
      skillMenuOpen &&
      (event.key === "Enter" || event.key === "Tab") &&
      skillResults[activeSkillIndex]
    ) {
      event.preventDefault()
      event.stopPropagation()
      selectSkill(skillResults[activeSkillIndex])
      return
    }
    if (skillMenuOpen && event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDismissedSkillTrigger(skillTriggerKey)
      return
    }
    if (fileMenuOpen && event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      setActiveFileIndex((index) =>
        fileResults.length ? (index + 1) % fileResults.length : 0
      )
      return
    }
    if (fileMenuOpen && event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setActiveFileIndex((index) =>
        fileResults.length
          ? (index - 1 + fileResults.length) % fileResults.length
          : 0
      )
      return
    }
    if (
      fileMenuOpen &&
      (event.key === "Enter" || event.key === "Tab") &&
      fileResults[activeFileIndex]
    ) {
      event.preventDefault()
      event.stopPropagation()
      selectFile(fileResults[activeFileIndex].path)
      return
    }
    if (fileMenuOpen && event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setDismissedFileTrigger(fileTriggerKey)
      return
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      event.stopPropagation()
      const content = promptContentFromEditor(editor, skills)
      onSubmit(content, promptTextFromContent(content))
    }
  }

  return (
    <div
      className="relative min-h-16 cursor-text"
      onMouseDown={focusEditorFromPadding}
      onKeyDownCapture={handleKeyDownCapture}
      data-disabled={disabled || undefined}
    >
      {skillMenuOpen ? (
        <SkillSearchMenu
          results={skillResults}
          activeIndex={activeSkillIndex}
          onSelect={selectSkill}
        />
      ) : fileMenuOpen ? (
        <FileSearchMenu
          results={fileResults}
          activeIndex={activeFileIndex}
          onSelect={selectFile}
        />
      ) : null}
      {editor?.isEmpty ? (
        <span className="pointer-events-none absolute inset-x-1 top-1 z-10 text-sm leading-6 text-muted-foreground/55">
          {placeholder}
        </span>
      ) : null}
      <EditorContent
        editor={editor}
        className="scrollbar-hide max-h-48 min-h-16 overflow-y-auto px-1 pt-1 pb-2 text-sm leading-6 text-foreground ring-0 outline-none focus:ring-0 focus:outline-none"
        style={{
          minHeight: `${minRows * 24}px`,
          maxHeight: `${maxRows * 24}px`,
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          void insertImages(Array.from(event.target.files ?? []))
          event.target.value = ""
        }}
      />
    </div>
  )
}

function promptContentFromEditor(
  editor: Editor | null,
  skills: readonly AgentSkill[]
): ContentPart[] {
  if (!editor) return promptContentFromMarkdown("", skills)
  const parts: ContentPart[] = []
  const appendText = (text: string) => {
    if (!text) return
    const last = parts.at(-1)
    if (last?.type === "text") last.text += text
    else parts.push({ type: "text", text })
  }
  editor.state.doc.forEach((block, _offset, index) => {
    if (index > 0) appendText("\n")
    block.forEach((node) => {
      if (node.type.name === "text") appendText(node.text ?? "")
      else if (node.type.name === "hardBreak") appendText("\n")
      else if (node.type.name === "fileMention")
        appendText(`@${node.attrs.path}`)
      else if (node.type.name === "skillMention") {
        parts.push({
          type: "skill",
          name: node.attrs.name,
          path: node.attrs.path ?? null,
        })
      } else if (node.type.name === "imageMention") {
        parts.push({
          type: "image",
          media_type: node.attrs.mediaType,
          data: node.attrs.data,
          name: node.attrs.name || null,
        })
      }
    })
  })
  return parts.length ? parts : [{ type: "text", text: "" }]
}
