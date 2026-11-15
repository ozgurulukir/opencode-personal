import { cmd } from "./cmd"
import { GithubInstallCommand } from "./github/install"
import { GithubRunCommand } from "./github/run"
import {
  SAFE_ATTACHMENT_REGEX,
  isSafeGitHubAttachmentUrl,
  extractResponseText,
  formatPromptTooLargeError,
  parseGitHubRemote,
} from "./github/helpers"

export {
  SAFE_ATTACHMENT_REGEX,
  isSafeGitHubAttachmentUrl,
  extractResponseText,
  formatPromptTooLargeError,
  parseGitHubRemote,
  GithubInstallCommand,
  GithubRunCommand,
}

export const GithubCommand = cmd({
  command: "github",
  describe: "manage GitHub agent",
  builder: (yargs) => yargs.command(GithubInstallCommand).command(GithubRunCommand).demandCommand(),
  async handler() {},
})
