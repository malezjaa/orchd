export interface RankedFile {
  path: string
  score: number
}

function subsequenceScore(query: string, candidate: string): number | null {
  let queryIndex = 0
  let score = 0
  let previousMatch = -1

  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue

    const atWordBoundary =
      index === 0 || "/\\_- .".includes(candidate[index - 1] ?? "")
    const isContiguous = previousMatch === index - 1
    score += atWordBoundary ? 12 : isContiguous ? 7 : 3
    previousMatch = index
    queryIndex += 1
    if (queryIndex === query.length) return score
  }

  return null
}

function scoreFile(query: string, path: string): number | null {
  const normalizedPath = path.toLowerCase()
  const basename = normalizedPath.split("/").pop() ?? normalizedPath
  const queryInPath = normalizedPath.indexOf(query)
  const queryInBasename = basename.indexOf(query)
  const fuzzyPath = subsequenceScore(query, normalizedPath)

  if (fuzzyPath === null) return null

  let score = fuzzyPath - normalizedPath.length * 0.03
  if (queryInBasename === 0) score += 90
  else if (queryInBasename > 0) score += 35
  if (queryInPath === 0) score += 30
  else if (queryInPath > 0) score += 12
  if (normalizedPath === query) score += 200

  return score
}

export function searchFiles(
  paths: readonly string[],
  query: string,
  limit = 8
): RankedFile[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return paths.slice(0, limit).map((path) => ({ path, score: 0 }))
  }

  return paths
    .map((path) => {
      const score = scoreFile(normalizedQuery, path)
      return score === null ? null : { path, score }
    })
    .filter((result): result is RankedFile => result !== null)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path)
    )
    .slice(0, limit)
}
