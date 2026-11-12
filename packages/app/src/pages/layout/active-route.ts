import { createEffect, on, type Accessor } from "solid-js"

export type ActiveRouteState = {
  session: string
  sessionProject: string
  directory: string
}

export type ActiveRouteTransition = {
  ready: boolean
  slug: string | undefined
  id: string | undefined
  root: string | undefined
  dir: string
  serverRoot: string | undefined
}

export type ActiveRouteAction =
  | { kind: "reset" }
  | { kind: "project"; session: string; directory: string }
  | { kind: "sync"; session: string; directory: string; id: string; root: string; touch: boolean }
  | { kind: "remember"; directory: string; id: string; root: string; touch: boolean }
  | { kind: "none"; root: string; touch: boolean }

/**
 * Pure decision ladder for the active-route sync effect. Mirrors the inline
 * behavior it replaces: the project touch fires whenever the route resolves to
 * a project root — including the "none" path where route and project are
 * unchanged but the server's last-opened project still points elsewhere.
 */
export function activeRouteTransition(prev: ActiveRouteState, input: ActiveRouteTransition): ActiveRouteAction {
  if (!input.ready || !input.slug || !input.dir) return { kind: "reset" }
  if (!input.id) return { kind: "reset" }

  const session = `${input.slug}/${input.id}`

  if (!input.root) return { kind: "project", session, directory: input.dir }

  const touch = input.serverRoot !== input.root
  const changed = session !== prev.session || input.dir !== prev.directory
  if (changed) return { kind: "sync", session, directory: input.dir, id: input.id, root: input.root, touch }
  if (input.root === prev.sessionProject) return { kind: "none", root: input.root, touch }
  return { kind: "remember", directory: input.dir, id: input.id, root: input.root, touch }
}

export function createActiveRouteSync(input: {
  pageReady: Accessor<boolean>
  slug: Accessor<string | undefined>
  sessionId: Accessor<string | undefined>
  projectRoot: Accessor<string | undefined>
  directory: Accessor<string>
  lastServerProjectRoot: () => string | undefined
  touchProject: (root: string) => void
  syncSessionRoute: (directory: string, id: string, root: string) => string
  rememberSessionRoute: (directory: string, id: string, root: string) => string
}): ActiveRouteState {
  const activeRoute: ActiveRouteState = { session: "", sessionProject: "", directory: "" }

  createEffect(
    on(
      () => {
        return [input.pageReady(), input.slug(), input.sessionId(), input.projectRoot(), input.directory()] as const
      },
      ([ready, slug, id, root, dir]) => {
        const action = activeRouteTransition(activeRoute, {
          ready,
          slug,
          id,
          root,
          dir,
          serverRoot: input.lastServerProjectRoot(),
        })

        if (action.kind === "reset") {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        if (action.kind === "project") {
          activeRoute.session = action.session
          activeRoute.directory = action.directory
          activeRoute.sessionProject = ""
          return
        }

        if (action.touch) input.touchProject(action.root)

        if (action.kind === "none") return

        if (action.kind === "sync") {
          activeRoute.session = action.session
          activeRoute.directory = action.directory
          activeRoute.sessionProject = input.syncSessionRoute(action.directory, action.id, action.root)
          return
        }

        activeRoute.directory = action.directory
        activeRoute.sessionProject = input.rememberSessionRoute(action.directory, action.id, action.root)
      },
    ),
  )

  return activeRoute
}
