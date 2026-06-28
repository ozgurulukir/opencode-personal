import z from "zod"

const PositionSchema = z.object({
  line: z.number(),
  character: z.number(),
})

const EditorSelectionRangeSchema = z.object({
  text: z.string(),
  selection: z.object({
    start: PositionSchema,
    end: PositionSchema,
  }),
})

export const EditorSelectionSchema = z
  .union([
    z.object({
      filePath: z.string(),
      source: z.enum(["websocket", "zed"]).optional(),
      ranges: z.array(EditorSelectionRangeSchema).min(1),
    }),
    z.object({
      text: z.string(),
      filePath: z.string(),
      source: z.enum(["websocket", "zed"]).optional(),
      selection: z.object({
        start: PositionSchema,
        end: PositionSchema,
      }),
    }),
  ])
  .transform((value) =>
    "ranges" in value
      ? value
      : {
          filePath: value.filePath,
          source: value.source,
          ranges: [
            {
              text: value.text,
              selection: value.selection,
            },
          ],
        },
  )

export type EditorSelection = z.infer<typeof EditorSelectionSchema>
