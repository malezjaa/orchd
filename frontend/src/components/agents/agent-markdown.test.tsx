import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vite-plus/test"
import { AgentMarkdown } from "@/components/agents/agent-markdown"

describe("AgentMarkdown file mentions", () => {
  it("keeps file links in the app when no opener is available", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown>[file_tree.rs](file_tree.rs)</AgentMarkdown>
    )

    expect(markup).not.toContain('href="file_tree.rs"')
    expect(markup).toContain(">_</span>")
  })

  it("renders file links as interactive chips when an opener is provided", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown onFileOpen={() => {}}>
        [file_tree.rs](file_tree.rs)
      </AgentMarkdown>
    )

    expect(markup).toContain("<button")
    expect(markup).toContain("aria-label=\"Open file_tree.rs\"")
  })

  it("recognizes absolute project file links as file mentions", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown onFileOpen={() => {}}>
        [file_tree.rs](/home/malezjaa/projects/ai-app/crates/orchd-api/src/file_tree.rs)
      </AgentMarkdown>
    )

    expect(markup).not.toContain(
      'href="/home/malezjaa/projects/ai-app/crates/orchd-api/src/file_tree.rs"'
    )
    expect(markup).toContain(
      'aria-label="Open /home/malezjaa/projects/ai-app/crates/orchd-api/src/file_tree.rs"'
    )
  })

  it("uses the subagent status color for markdown mentions", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown
        subagents={[{ thread_id: "thread-1", status: "pending" }]}
      >
        [[subagent:thread-1|Mencius]]
      </AgentMarkdown>
    )

    expect(markup).toContain("bg-amber-500/10")
    expect(markup).not.toContain("bg-sky-500/10")
  })
})
