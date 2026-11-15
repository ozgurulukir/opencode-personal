import path from "path"
import { spawn } from "child_process"
import { Filesystem } from "@/util/filesystem"
import * as prompts from "@clack/prompts"
import { map, pipe, sortBy, values } from "remeda"
import { UI } from "../../ui"
import { effectCmd } from "../../effect-cmd"
import { ModelsDev } from "@/provider/models"
import { InstanceRef } from "@/effect/instance-ref"
import { Git } from "@/git"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect } from "effect"
import { WORKFLOW_FILE } from "./types"
import { parseGitHubRemote } from "./helpers"

export const GithubInstallCommand = effectCmd({
  command: "install",
  describe: "install the GitHub agent",
  handler: Effect.fn("Cli.github.install")(function* () {
    const maybeCtx = yield* InstanceRef
    if (!maybeCtx) return yield* Effect.die("InstanceRef not provided")
    const ctx = maybeCtx
    const modelsDev = yield* ModelsDev.Service
    const gitSvc = yield* Git.Service
    yield* Effect.promise(async () => {
      {
        UI.empty()
        prompts.intro("Install GitHub agent")
        const app = await getAppInfo()
        await installGitHubApp()

        const providers = await Effect.runPromise(modelsDev.get())

        const provider = await promptProvider()
        const model = await promptModel()

        await addWorkflowFiles()
        printNextSteps()

        function printNextSteps() {
          let step2
          if (provider === "amazon-bedrock") {
            step2 =
              "Configure OIDC in AWS - https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services"
          } else if (provider === "github-copilot") {
            step2 = [
              "    2. Run `opencode auth login` and authenticate with GitHub Copilot",
              "",
              `       Add the Copilot OAuth access token as COPILOT_TOKEN in ${app.owner}/${app.repo} secrets`,
              "       Use the token from the github-copilot entry in your local OpenCode auth.json",
              "       The automatic GitHub Actions GITHUB_TOKEN does not authenticate your Copilot subscription",
              "",
              "       Read setup guide - https://opencode.ai/docs/providers/#github-copilot",
            ].join("\n")
          } else {
            step2 = [
              `    2. Add the following secrets in org or repo (${app.owner}/${app.repo}) settings`,
              "",
              ...providers[provider].env.map((e) => `       - ${e}`),
            ].join("\n")
          }

          prompts.outro(
            [
              "Next steps:",
              "",
              `    1. Commit the \`${WORKFLOW_FILE}\` file and push`,
              step2,
              "",
              "    3. Go to a GitHub issue and comment `/oc summarize` to see the agent in action",
              "",
              "   Learn more about the GitHub agent - https://opencode.ai/docs/github/#usage-examples",
            ].join("\n"),
          )
        }

        async function getAppInfo() {
          const project = ctx.project
          if (project.vcs !== "git") {
            prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
            throw new UI.CancelledError()
          }

          // Get repo info
          const info = await Effect.runPromise(gitSvc.run(["remote", "get-url", "origin"], { cwd: ctx.worktree })).then(
            (x) => x.text().trim(),
          )
          const parsed = parseGitHubRemote(info)
          if (!parsed) {
            prompts.log.error(`Could not find git repository. Please run this command from a git repository.`)
            throw new UI.CancelledError()
          }
          return { owner: parsed.owner, repo: parsed.repo, root: ctx.worktree }
        }

        async function promptProvider() {
          const priority: Record<string, number> = {
            opencode: 0,
            anthropic: 1,
            openai: 2,
            "github-copilot": 3,
            google: 4,
          }
          let provider = await prompts.select({
            message: "Select provider",
            maxItems: 8,
            options: pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: priority[x.id] === 0 ? "recommended" : undefined,
              })),
            ),
          })

          if (prompts.isCancel(provider)) throw new UI.CancelledError()

          return provider
        }

        async function promptModel() {
          const providerData = providers[provider]!

          const model = await prompts.select({
            message: "Select model",
            maxItems: 8,
            options: pipe(
              providerData.models,
              values(),
              sortBy((x) => x.name ?? x.id),
              map((x) => ({
                label: x.name ?? x.id,
                value: x.id,
              })),
            ),
          })

          if (prompts.isCancel(model)) throw new UI.CancelledError()
          return model
        }

        async function installGitHubApp() {
          const s = prompts.spinner()
          s.start("Installing GitHub app")

          // Get installation
          const installation = await getInstallation()
          if (installation) return s.stop("GitHub app already installed")

          // Open browser — spawn with argument array to avoid shell injection
          const url = "https://github.com/apps/opencode-agent"
          const child =
            process.platform === "darwin"
              ? spawn("open", [url])
              : process.platform === "win32"
                ? spawn("cmd.exe", ["/c", "start", "", url])
                : spawn("xdg-open", [url])
          child.on("error", () => {
            prompts.log.warn(`Could not open browser. Please visit: ${url}`)
          })

          // Wait for installation
          s.message("Waiting for GitHub app to be installed")
          const MAX_RETRIES = 120
          let retries = 0
          do {
            const installation = await getInstallation()
            if (installation) break

            if (retries > MAX_RETRIES) {
              s.stop(
                `Failed to detect GitHub app installation. Make sure to install the app for the \`${app.owner}/${app.repo}\` repository.`,
              )
              throw new UI.CancelledError()
            }

            retries++
            await sleep(1000)
          } while (true) // oxlint-disable-line no-constant-condition

          s.stop("Installed GitHub app")

          async function getInstallation() {
            return await fetch(
              `https://api.opencode.ai/get_github_app_installation?owner=${app.owner}&repo=${app.repo}`,
            )
              .then((res) => res.json())
              .then((data) => data.installation)
          }
        }

        async function addWorkflowFiles() {
          const envStr =
            provider === "amazon-bedrock"
              ? ""
              : provider === "github-copilot"
                ? "\n        env:\n          GITHUB_TOKEN: ${{ secrets.COPILOT_TOKEN }}"
                : `\n        env:${providers[provider].env.map((e) => `\n          ${e}: \${{ secrets.${e} }}`).join("")}`

          await Filesystem.write(
            path.join(app.root, WORKFLOW_FILE),
            `name: opencode

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

jobs:
  opencode:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencode') ||
      startsWith(github.event.comment.body, '/opencode')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run opencode
        uses: anomalyco/opencode/github@latest${envStr}
        with:
          model: ${provider}/${model}`,
          )

          prompts.log.success(`Added workflow file: "${WORKFLOW_FILE}"`)
        }
      }
    })
  }),
})
