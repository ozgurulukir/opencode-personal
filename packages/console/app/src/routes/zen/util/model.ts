import { ModelError } from "./error"

export function validateModel(
  zenData: any,
  reqModel: string,
  deps: { format: string; t: (key: any, params?: Record<string, string | number>) => string },
) {
  if (!(reqModel in zenData.models))
    throw new ModelError(deps.t("zen.api.error.modelNotSupported", { model: reqModel }))

  const modelId = reqModel
  const modelData = Array.isArray(zenData.models[modelId])
    ? zenData.models[modelId].find((model: any) => deps.format === model.formatFilter)
    : zenData.models[modelId]

  if (!modelData)
    throw new ModelError(
      deps.t("zen.api.error.modelFormatNotSupported", {
        model: reqModel,
        format: deps.format,
      }),
    )

  if (modelData.trialEnded)
    throw new ModelError(
      `${deps.t("zen.api.error.trialEnded", {
        model: modelData.name,
        link: "https://opencode.ai/go",
      })}`,
    )

  return { id: modelId, ...modelData }
}
