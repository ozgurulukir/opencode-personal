## Usage

Dependencies for these templates are managed with [pnpm](https://pnpm.io) using `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That said, any package manager will work. This file can safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## E2E Testing

Playwright starts the Vite dev server automatically via `webServer`. The
opencode transport is **mocked in-process** with Playwright `page.route` (see
`e2e/mock-api.ts`): REST fixtures plus a two-phase SSE `/global/event` stream
that delivers a scripted `session.next.prompted` frame after the prompt is
observed. **No `opencode serve` backend is required.**

```bash
bunx playwright install chromium
bun run test:e2e:local
bun run test:e2e:local -- --grep "critical path"
```

The critical-path spec (`e2e/critical-path.spec.ts`) boots the app, opens a
session, sends a prompt, and asserts the optimistic bubble resolves to the
scripted server message. Set `E2E_FAIL_PROMPT_ASYNC=1` to run the negative
regression check (`prompt_async` returns 500; the spec must fail).

Environment options:

- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (mocked backend address, default: `127.0.0.1:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://127.0.0.1:<PLAYWRIGHT_PORT>`)
- `E2E_FAIL_PROMPT_ASYNC` (negative-check flag; unset by default)

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
