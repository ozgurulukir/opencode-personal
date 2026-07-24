import { ComponentProps, For } from "solid-js"

const outerIndices = new Set([1, 2, 4, 7, 8, 11, 13, 14])
const cornerIndices = new Set([0, 3, 12, 15])

// Deterministic delay/duration values — no Math.random to ensure SSR/HMR stability
const delays = [0, 0.4, 0.8, 1.2, 0.2, 0.6, 1.0, 1.4, 0.1, 0.5, 0.9, 1.3, 0.3, 0.7, 1.1, 1.5]
const durations = [1.2, 1.5, 1.8, 1.1, 1.4, 1.7, 1.3, 1.6, 1.0, 1.9, 1.2, 1.5, 1.8, 1.1, 1.4, 1.7]
const squares = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  x: (i % 4) * 4,
  y: Math.floor(i / 4) * 4,
  delay: delays[i],
  duration: durations[i],
  outer: outerIndices.has(i),
  corner: cornerIndices.has(i),
}))

export function Spinner(props: {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
}) {
  return (
    <svg
      {...props}
      viewBox="0 0 15 15"
      data-component="spinner"
      role="status"
      aria-label="Loading"
      classList={{
        ...props.classList,
        ...(props.class ? { [props.class]: true } : {}),
      }}
      fill="currentColor"
    >
      <For each={squares}>
        {(square) => (
          <rect
            x={square.x}
            y={square.y}
            width="3"
            height="3"
            rx="1"
            style={{
              opacity: square.corner ? 0 : undefined,
              animation: square.corner
                ? undefined
                : `${square.outer ? "pulse-opacity-dim" : "pulse-opacity"} ${square.duration}s ease-in-out infinite`,
              "animation-fill-mode": square.corner ? undefined : "both",
              "animation-delay": square.corner ? undefined : `${square.delay}s`,
            }}
          />
        )}
      </For>
    </svg>
  )
}
