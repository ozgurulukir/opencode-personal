import z from "zod"

const HexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
const ColorReference = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
const ColorScalar = z.union([
  HexColor,
  z.number().int().min(0).max(255),
  z.literal("none"),
  z.literal("transparent"),
  ColorReference,
])
const ColorVariant = z
  .object({
    dark: ColorScalar,
    light: ColorScalar,
  })
  .strict()
const ColorValue = z.union([ColorScalar, ColorVariant])

const ThemeColors = {
  primary: ColorValue,
  secondary: ColorValue,
  accent: ColorValue,
  error: ColorValue,
  warning: ColorValue,
  success: ColorValue,
  info: ColorValue,
  text: ColorValue,
  textMuted: ColorValue,
  background: ColorValue,
  backgroundPanel: ColorValue,
  backgroundElement: ColorValue,
  border: ColorValue,
  borderActive: ColorValue,
  borderSubtle: ColorValue,
  diffAdded: ColorValue,
  diffRemoved: ColorValue,
  diffContext: ColorValue,
  diffHunkHeader: ColorValue,
  diffHighlightAdded: ColorValue,
  diffHighlightRemoved: ColorValue,
  diffAddedBg: ColorValue,
  diffRemovedBg: ColorValue,
  diffContextBg: ColorValue,
  diffLineNumber: ColorValue,
  diffAddedLineNumberBg: ColorValue,
  diffRemovedLineNumberBg: ColorValue,
  markdownText: ColorValue,
  markdownHeading: ColorValue,
  markdownLink: ColorValue,
  markdownLinkText: ColorValue,
  markdownCode: ColorValue,
  markdownBlockQuote: ColorValue,
  markdownEmph: ColorValue,
  markdownStrong: ColorValue,
  markdownHorizontalRule: ColorValue,
  markdownListItem: ColorValue,
  markdownListEnumeration: ColorValue,
  markdownImage: ColorValue,
  markdownImageText: ColorValue,
  markdownCodeBlock: ColorValue,
  syntaxComment: ColorValue,
  syntaxKeyword: ColorValue,
  syntaxFunction: ColorValue,
  syntaxVariable: ColorValue,
  syntaxString: ColorValue,
  syntaxNumber: ColorValue,
  syntaxType: ColorValue,
  syntaxOperator: ColorValue,
  syntaxPunctuation: ColorValue,
}

export const ThemeJsonSchema = z
  .object({
    $schema: z.string().optional(),
    defs: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/), ColorScalar).optional(),
    theme: z
      .object({
        ...ThemeColors,
        selectedListItemText: ColorValue.optional(),
        backgroundMenu: ColorValue.optional(),
        thinkingOpacity: z.number().optional(),
      })
      .strict(),
  })
  .strict()
  .meta({
    title: "OpenCode TUI Theme",
  })
