declare module "virtual:starlight/user-images" {
  export const logos: {
    dark?: {
      src: string
      width: number
      height: number
    }
    light?: {
      src: string
      width: number
      height: number
    }
  }
}

declare module "virtual:starlight/user-config" {
  import type { StarlightConfig } from "@astrojs/starlight/types"
  const config: StarlightConfig
  export default config
}
