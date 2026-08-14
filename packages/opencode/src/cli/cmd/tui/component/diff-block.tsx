/** @jsxImportSource @opentui/solid */
import { useTheme } from "../context/theme"

/**
 * Themed wrapper around the native <diff> element: single source for the diff
 * theme props shared by the v1/v2 session views and the permission diff route.
 * Callers keep their own view/filetype/wrapMode computation and surrounding
 * padding boxes.
 */
export function ThemedDiff(props: {
  diff: string | undefined
  view: "split" | "unified"
  filetype: string | undefined
  wrapMode: "word" | "none"
}) {
  const { theme, syntax } = useTheme()
  return (
    <diff
      diff={props.diff}
      view={props.view}
      filetype={props.filetype}
      syntaxStyle={syntax()}
      showLineNumbers={true}
      width="100%"
      wrapMode={props.wrapMode}
      fg={theme.text}
      addedBg={theme.diffAddedBg}
      removedBg={theme.diffRemovedBg}
      contextBg={theme.diffContextBg}
      addedSignColor={theme.diffHighlightAdded}
      removedSignColor={theme.diffHighlightRemoved}
      lineNumberFg={theme.diffLineNumber}
      lineNumberBg={theme.diffContextBg}
      addedLineNumberBg={theme.diffAddedLineNumberBg}
      removedLineNumberBg={theme.diffRemovedLineNumberBg}
    />
  )
}
