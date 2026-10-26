// @ts-nocheck
import { Icon } from "./icon"
import * as mod from "./checkbox"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Checkbox control for multi-select or agreement inputs.

Use in forms and multi-select lists.

### API
- Uses Kobalte Checkbox props (\`checked\`, \`defaultChecked\`, \`onChange\`).
- Optional: \`hideLabel\`, \`description\`, \`icon\`.
- Children render as the label.

### Variants and states
- Checked/unchecked, indeterminate, disabled (via Kobalte).

### Behavior
- Controlled or uncontrolled usage.

### Accessibility
- Standard native \`<input type="checkbox">\` semantics managed by Kobalte.
- Uses \`role="checkbox"\` with automatic state management (\`aria-checked\`, \`aria-disabled\`, \`aria-invalid\`).
- Label is connected via \`aria-labelledby\` and description text is associated via \`aria-describedby\`.
- Fully accessible via keyboard navigation (Focusable via \`Tab\`, toggles state on \`Space\`).

### Theming/tokens
- Uses \`data-component="checkbox"\` and related slots.

`

const story = create({ title: "UI/Checkbox", mod, args: { children: "Checkbox", defaultChecked: true } })
export default {
  title: "UI/Checkbox",
  id: "components-checkbox",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const States = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Checkbox defaultChecked>Checked</mod.Checkbox>
      <mod.Checkbox>Unchecked</mod.Checkbox>
      <mod.Checkbox disabled>Disabled</mod.Checkbox>
      <mod.Checkbox description="Helper text">With description</mod.Checkbox>
    </div>
  ),
}

export const CustomIcon = {
  render: () => (
    <mod.Checkbox icon={<Icon name="check" size="small" />} defaultChecked>
      Custom icon
    </mod.Checkbox>
  ),
}

export const HiddenLabel = {
  args: {
    children: "Hidden label",
    hideLabel: true,
  },
}
