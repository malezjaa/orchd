import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getBuiltInSpriteSheet } from "@pierre/trees"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function FileIconSprite() {
  const sprite = getBuiltInSpriteSheet("complete")

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      dangerouslySetInnerHTML={{ __html: sprite }}
    />
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delay={200}>
          <App />

          <FileIconSprite />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
