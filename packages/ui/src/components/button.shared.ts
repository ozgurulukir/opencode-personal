export interface ButtonStateOptions {
  disabled?: boolean
  loading?: boolean
}

export function buttonState(options: ButtonStateOptions) {
  const disabled = Boolean(options.disabled || options.loading)
  return {
    disabled,
    ariaBusy: options.loading ? ("true" as const) : undefined,
    dataLoading: options.loading ? ("" as const) : undefined,
  }
}
