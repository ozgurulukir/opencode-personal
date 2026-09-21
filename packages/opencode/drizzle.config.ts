import path from "path"
import os from "os"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dbCredentials: {
    // Override with OPENCODE_DB_PATH to point at a specific db file.
    // Defaults to the runtime location under the user's home directory.
    url: process.env.OPENCODE_DB_PATH ?? path.join(os.homedir(), ".local", "share", "opencode", "opencode.db"),
  },
})
