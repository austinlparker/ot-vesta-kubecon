import { Application, Router } from "jsr:@oak/oak";
import { isHttpError } from "jsr:@oak/commons/http_errors";
import { Status } from "jsr:@oak/commons/status";
import { VestaboardClient } from "./vesta.ts";
import { handleWebhookEvent } from "./handler.ts";
import type { WebhookEvent } from "@octokit/webhooks-types";
import { Registry } from "https://deno.land/x/ts_prometheus/mod.ts";
import {
  httpRequestDuration,
  httpRequestsTotal,
  messageStoreLockouts,
  vestaboardApiErrors,
  queuePauseTotal
} from "./metrics.ts";
import { MessageStore } from "./message_store.ts";
import { initializeJetstream } from "./bsky.ts";
import { ContentFilter } from "./mod.ts";

// Configuration
const isDev = Deno.env.get("DEV_MODE") === "true";
const port = parseInt(Deno.env.get("PORT") || "3000");
const vestaboardApiKey = Deno.env.get("VESTABOARD_API_KEY");
const dbPath = Deno.env.get("DB_PATH") || "./messages.db";

if (!isDev && !vestaboardApiKey) {
  console.error("VESTABOARD_API_KEY is required in production mode");
  Deno.exit(1);
}
const openAiKey = Deno.env.get("OPENAI_API_KEY");
if (!openAiKey) {
  console.error("OPENAI_API_KEY is required");
  Deno.exit(1);
}

// Initialize clients
const messageStore = new MessageStore(dbPath);
const vc = new VestaboardClient({
  apiKey: vestaboardApiKey!,
  devMode: isDev,
  baseUrl: "https://rw.vestaboard.com",
  queueInterval: parseInt(Deno.env.get("QUEUE_INTERVAL_MS") || "60000"),
  rateLimitMs: parseInt(Deno.env.get("RATE_LIMIT_MS") || "30000"),
  retryAttempts: parseInt(Deno.env.get("RETRY_ATTEMPTS") || "3"),
}, messageStore);
const apiRouter = new Router({ prefix: "/api" });
const metricsRouter = new Router();

const contentFilter = new ContentFilter(openAiKey);
const jetstream = initializeJetstream(messageStore, vc, contentFilter);

jetstream.start()

const app = new Application();
const metricsApp = new Application();

vc.startProcessingQueue();

app.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    const ms = Date.now() - start;
    const path = ctx.request.url.pathname;
    const method = ctx.request.method;
    const status = ctx.response.status;

    httpRequestsTotal.labels({ method, path, status: String(status) }).inc();
    httpRequestDuration.labels({ method, path })
      .observe(ms / 1000); // Convert to seconds
  }
});

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

metricsRouter.get("/metrics", (ctx) => {
  ctx.response.headers.set("Content-Type", "text/plain");
  ctx.response.body = Registry.default.metrics();
});

// API Routes
apiRouter
  .get("/hello", async (ctx) => {
    try {
      const message = VestaboardClient.createTelescope();
      const formatted = await vc.formatMessage(message);
      const record = await vc.queueMessage(formatted, "hello");
      ctx.response.body = { message: "🔭", id: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "format" }).inc();
      throw error;
    }
  })
  .post("/board/lock", async (ctx) => {
    try {
      const { reason } = await ctx.request.body.json();
      messageStore.lock(reason);
      ctx.response.body = { status: "success", state: messageStore.getState() };
    } catch (error) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { error: "Invalid request body" };
    }
  })
  .post("/board/unlock", (ctx) => {
    messageStore.unlock();
    ctx.response.body = { status: "success", state: messageStore.getState() };
  })
  .post("/board/queue/pause", (ctx) => {
    try {
      messageStore.pauseQueue();
      queuePauseTotal.inc();
      ctx.response.body = { status: "success", state: messageStore.getState() };
    } catch (error) {
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { error: "Failed to pause queue" };
    }
  })
  .post("/board/queue/resume", (ctx) => {
    messageStore.resumeQueue();
    ctx.response.body = { status: "success", state: messageStore.getState() };
  })
  .post("/messages/:id/prioritize", async (ctx) => {
    const message = messageStore.getMessage(ctx.params.id);
    if (!message) {
      ctx.response.status = Status.NotFound;
      return;
    }
    messageStore.pushToFront(message);
    ctx.response.body = { status: "success", message };
  })
  .get("/board/current", async (ctx) => {
    const currentState = await vc.getCurrentState();
    const lastMessage = messageStore.getLatest();
    const state = messageStore.getState();

    ctx.response.body = {
      grid: currentState || Array(6).fill(undefined).map(() => Array(22).fill(0)),
      lastMessage,
      state,
    };
  })
  .get("/messages", (ctx) => {
    const limit = ctx.request.url.searchParams.get("limit");
    ctx.response.body = messageStore.getMessages(
      limit ? parseInt(limit) : undefined,
    );
  })
  .get("/messages/:id", (ctx) => {
    const message = messageStore.getMessage(ctx.params.id);
    if (!message) {
      ctx.response.status = Status.NotFound;
      return;
    }
    ctx.response.body = message;
  })
  .post("/messages/:id/replay", async (ctx) => {
    const message = messageStore.getMessage(ctx.params.id);
    if (!message) {
      ctx.response.status = Status.NotFound;
      return;
    }
    try {
      const record = await vc.queueMessage(message.grid, message.source);
      ctx.response.body = { status: "success", message, queuedId: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "queue" }).inc();
      throw error;
    }
  })
  .post("/webhook", async (ctx) => {
    if (messageStore.isLocked()) {
      messageStoreLockouts.inc();
      ctx.response.status = Status.Locked;
      ctx.response.body = {
        error: "Board is currently locked",
        state: messageStore.getState()
      };
      return;
    }

    try {
      const body = await ctx.request.body.json();
      const message = handleWebhookEvent(body as WebhookEvent);

      if (!message) {
        ctx.response.status = Status.NoContent;
        return;
      }

      const formatted = await vc.formatMessage(message);
      const record = await vc.queueMessage(formatted, "webhook", {
        event: body,
      });

      ctx.response.status = Status.OK;
      ctx.response.body = { status: "success", id: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "format" }).inc();
      throw error;
    }
  })
  .post("/board/send", async (ctx) => {
    const { grid } = await ctx.request.body.json();

    // Validate grid structure
    if (
      !Array.isArray(grid) ||
      grid.length !== 6 ||
      !grid.every((row) =>
        Array.isArray(row) &&
        row.length === 22 &&
        row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 71)
      )
    ) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { error: "Invalid grid format" };
      return;
    }

    try {
      const record = await vc.queueMessage(grid, "custom");
      ctx.response.status = Status.OK;
      ctx.response.body = { status: "success", id: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "queue" }).inc();
      throw error;
    }
  });

// Mount API routes
metricsApp.use(metricsRouter.routes());
metricsApp.use(metricsRouter.allowedMethods());
app.use(apiRouter.routes());
app.use(apiRouter.allowedMethods());

// Static file serving (after API routes)
app.use(async (ctx, next) => {
  if (
    ctx.request.method === "GET" &&
    !ctx.request.url.pathname.startsWith("/api") &&
    ctx.request.url.pathname !== "/metrics"
  ) {
    try {
      await ctx.send({
        root: `${Deno.cwd()}/static`,
        index: "index.html",
      });
    } catch (err) {
      console.log(`Static file error: ${err.message}`);
      await next();
    }
  } else {
    await next();
  }
});

// Error event handling
app.addEventListener("error", (evt) => {
  console.error("Application Error:", evt.error);
});

// Start server
console.log(
  `Starting server on port ${port} ${isDev ? "(development mode)" : ""}`,
);

metricsApp.addEventListener("listen", ({ hostname, port }) => {
  console.log(`📊 Metrics server listening on: http://${hostname}:${port}`);
});

app.addEventListener("listen", ({ hostname, port, secure }) => {
  console.log(
    `🚀 Server listening on: ${secure ? "https://" : "http://"}${hostname ?? "localhost"
    }:${port}`,
  );
});

Deno.addSignalListener("SIGINT", () => {
  messageStore.close();
  Deno.exit();
});

await Promise.all([
  app.listen({ port }),
  metricsApp.listen({ port: 9001, hostname: "0.0.0.0" }),
]);
