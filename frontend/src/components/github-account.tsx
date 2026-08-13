import { CircleUserRound, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useGitHubAccount } from "@/lib/queries"

export function GitHubAccount() {
  const account = useGitHubAccount()
  const isAuthenticated = account.data?.status === "authenticated"
  const displayName = account.data?.name || account.data?.login

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={
          isAuthenticated
            ? `GitHub account: ${displayName ?? account.data?.login}`
            : "GitHub account: not connected"
        }
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
      >
        <span className="relative grid size-7 place-items-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {account.isLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isAuthenticated && account.data?.avatar_url ? (
            <img
              src={account.data.avatar_url}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <CircleUserRound className="size-3.5" />
          )}
          {isAuthenticated ? (
            <span className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-muted" />
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 rounded-xl">
        {isAuthenticated ? (
          <PopoverHeader>
            <PopoverTitle className="flex items-center gap-2">
              <CircleUserRound className="size-4" />
              {displayName ?? account.data?.login}
            </PopoverTitle>
            <PopoverDescription>
              Connected through the GitHub CLI as @{account.data?.login}.
            </PopoverDescription>
          </PopoverHeader>
        ) : (
          <>
            <PopoverHeader>
              <PopoverTitle className="flex items-center gap-2">
                <CircleUserRound className="size-4" />
                Connect GitHub
              </PopoverTitle>
              <PopoverDescription>
                {account.data?.message ??
                  "Log in with the GitHub CLI to show your account here."}
              </PopoverDescription>
            </PopoverHeader>
            <code className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">
              gh auth login
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void account.refetch()}
              disabled={account.isFetching}
            >
              <RefreshCw
                className={account.isFetching ? "animate-spin" : undefined}
              />
              Check again
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
