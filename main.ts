import { Application, Router } from "jsr:@oak/oak";
import { isHttpError } from "jsr:@oak/commons/http_errors";
import { Status } from "jsr:@oak/commons/status";
import { VestaboardClient } from "./vesta.ts";
import { handleWebhookEvent } from "./handler.ts";
import type { WebhookEvent } from "@octokit/webhooks-types";

// Configuration
const isDev = Deno.env.get("DEV_MODE") === "true";
const port = parseInt(Deno.env.get("PORT") || "3000");
const vestaboardApiKey = isDev
  ? "fake-key"
  : Deno.env.get("VESTABOARD_API_KEY");

if (!isDev && !vestaboardApiKey) {
  console.error("VESTABOARD_API_KEY is required in production mode");
  Deno.exit(1);
}

// Initialize clients
const vc = new VestaboardClient(vestaboardApiKey!, isDev);
const router = new Router();
const app = new Application();

// Error handling middleware
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (isHttpError(err)) {
      ctx.response.status = err.status;
      ctx.response.body = {
        status: err.status,
        message: err.message,
      };

      console.error(`HTTP Error: ${err.status} - ${err.message}`);
    } else {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = {
        status: Status.InternalServerError,
        message: "Internal Server Error",
      };

      console.error("Unhandled Error:", err);
    }
  }
});

// Logging middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  ctx.response.headers.set("X-Response-Time", `${ms}ms`);
  console.log(`${ctx.request.method} ${ctx.request.url} - ${ms}ms`);
});

// Static file serving
app.use(async (ctx, next) => {
  if (ctx.request.method === "GET") {
    try {
      await ctx.send({
        root: `${Deno.cwd()}/static`,
        index: "index.html",
      });
    } catch {
      await next();
    }
  } else {
    await next();
  }
});

// Routes
router.get("/hello", async (ctx) => {
  await vc.formatAndSendMessage(VestaboardClient.createTelescope());
  ctx.response.body = "🔭";
});

router.post("/webhook", async (ctx) => {
  const body = await ctx.request.body.json();
  const message = handleWebhookEvent(body as WebhookEvent);

  if (!message) {
    ctx.response.status = Status.NoContent;
    console.log("Unhandled webhook event");
    return;
  }

  await vc.formatAndSendMessage(message);
  ctx.response.status = Status.OK;
});

router.post("/custom/send", async (ctx) => {
  const { grid } = await ctx.request.body.json();
  await vc.sendMessage(grid);
  ctx.response.status = Status.OK;
});

// Error event handling
app.addEventListener("error", (evt) => {
  console.error("Application Error:", evt.error);
});

// Start server
app.use(router.routes());
app.use(router.allowedMethods());

console.log(
  `Starting server on port ${port} ${isDev ? "(development mode)" : ""}`,
);

app.addEventListener("listen", ({ hostname, port, secure }) => {
  console.log(
    `🚀 Server listening on: ${secure ? "https://" : "http://"}${
      hostname ?? "localhost"
    }:${port}`,
  );
});

await app.listen({ port });
