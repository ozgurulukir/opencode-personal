export type ChangeMode = "git" | "branch" | "turn"
export type VcsMode = "git" | "branch"

export function changeModes(
  project: { vcs?: string } | undefined,
  vcs: { branch?: string; default_branch?: string } | undefined,
) {
  const modes: ChangeMode[] = []
  if (project?.vcs === "git") modes.push("git")
  if (project?.vcs === "git" && vcs?.branch && vcs?.default_branch && vcs.branch !== vcs.default_branch) {
    modes.push("branch")
  }
  modes.push("turn")
  return modes
}

export function resolveVcsMode(changes: ChangeMode) {
  if (changes === "git" || changes === "branch") return changes
  return undefined
}

export function isVcsChanges(changes: ChangeMode) {
  return changes === "git" || changes === "branch"
}

export function reviewDiffsFor<T>(changes: ChangeMode, vcsFetched: boolean, vcsData: T[] | undefined, turnDiffs: T[]) {
  if (isVcsChanges(changes)) {
    // avoids suspense
    return vcsFetched ? (vcsData ?? []) : []
  }
  return turnDiffs
}

export function reviewIsReady(changes: ChangeMode, vcsPending: boolean) {
  if (isVcsChanges(changes)) return !vcsPending
  return true
}

export function newSessionWorktreeFor(setting: string, project: { worktree?: string } | undefined, directory: string) {
  if (setting === "create") return "create"
  if (project && directory !== project.worktree) return directory
  return "main"
}
