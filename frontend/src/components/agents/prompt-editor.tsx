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
import { CornerDownLeft, FileCode2 } from "lucide-react"
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
import { cn } from "@/lib/utils"

interface FileTrigger {
  from: number
  to: number
  query: string
}

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

function FileSearchMenu({
  results,
  activeIndex,
  onSelect,
}: {
  results: RankedFile[]
  activeIndex: number
  onSelect: (path: string) => void
}) {
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

export interface PromptEditorProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  filePaths: readonly string[]
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
  minRows,
  maxRows,
  placeholder,
  ariaLabel,
  disabled = false,
}: PromptEditorProps) {
  const onValueChangeRef = useRef(onValueChange)
  const [, setEditorVersion] = useState(0)
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [dismissedFileTrigger, setDismissedFileTrigger] = useState<
    string | null
  >(null)

  onValueChangeRef.current = onValueChange

  const editor = useEditor(
    {
      extensions: [StarterKit, FileMentionNode, Markdown],
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
      },
    },
    []
  )

  useEffect(() => {
    if (!editor) return

    const refresh = () => setEditorVersion((version) => version + 1)
    const updateValue = () => {
      onValueChangeRef.current(editor.getMarkdown())
      refresh()
    }

    editor.on("update", updateValue)
    editor.on("selectionUpdate", refresh)
    return () => {
      editor.off("update", updateValue)
      editor.off("selectionUpdate", refresh)
    }
  }, [editor])

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

  useEffect(() => {
    setActiveFileIndex((index) =>
      fileResults.length ? Math.min(index, fileResults.length - 1) : 0
    )
  }, [fileResults.length])

  useEffect(() => {
    setActiveFileIndex(0)
    setDismissedFileTrigger(null)
  }, [fileTriggerKey])

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

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
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
      onSubmit()
    }
  }

  return (
    <div
      className="relative min-h-16 cursor-text"
      onMouseDown={focusEditorFromPadding}
      onKeyDownCapture={handleKeyDownCapture}
      data-disabled={disabled || undefined}
    >
      {fileMenuOpen ? (
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
    </div>
  )
}
