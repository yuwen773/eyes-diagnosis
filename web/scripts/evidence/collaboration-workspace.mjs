/** Local opt-in fixture acceptance. Own the Vite server directly so cleanup also works on Windows. */
import { spawn } from "node:child_process"
import { createServer, preview } from "vite"

const args = process.argv.slice(2)
const defaultOff = args[0] === "--default-off"
if (defaultOff) args.shift()
process.env.VITE_COLLABORATION_ENABLED = defaultOff ? "false" : "true"
const options = {
  logLevel: "error",
  server: { host: "127.0.0.1", port: 5195, strictPort: true },
  preview: { host: "127.0.0.1", port: 5195, strictPort: true },
}
const server = defaultOff ? await preview(options) : await createServer(options)
try {
  if (!defaultOff) await server.listen()
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        defaultOff
          ? "e2e/collaboration-default-off.spec.ts"
          : "e2e/collaboration.spec.ts",
        "--workers=1",
        ...args,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, E2E_BASE_URL: "http://127.0.0.1:5195" },
      }
    )
    child.once("error", reject)
    child.once("exit", (code) => resolve(code ?? 1))
  })
} finally {
  if (defaultOff)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve()))
    )
  else await server.close()
}
