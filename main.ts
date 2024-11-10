import { Application, Router } from "jsr:@oak/oak";
import { isHttpError } from "jsr:@oak/commons/http_errors";
import { Status } from "jsr:@oak/commons/status";
import { VestaboardClient } from "./vesta.ts";
import { handleWebhookEvent } from "./handler.ts";
import type { WebhookEvent } from "@octokit/webhooks-types";
import { Registry } from "https://deno.land/x/ts_prometheus/mod.ts";
import { Counter, Histogram } from "https://deno.land/x/ts_prometheus/mod.ts";
import { MessageStore } from "./message_store.ts";
import { initializeJetstream } from "./bsky.ts";
import { ContentFilter } from "./mod.ts";

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
const openAiKey = Deno.env.get("OPENAI_API_KEY");
if (!openAiKey) {
  console.error("OPENAI_API_KEY is required");
  Deno.exit(1);
}

// HTTP metrics
export const httpRequestsTotal = Counter.with({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labels: ["method", "path", "status"],
});

export const httpRequestDuration = Histogram.with({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labels: ["method", "path"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // in seconds
});

// API-specific metrics
export const messagesSentTotal = Counter.with({
  name: "messages_sent_total",
  help: "Total number of messages sent to Vestaboard",
  labels: ["source"], // source can be 'hello', 'webhook', 'custom', 'bluesky'
});

export const messageStoreLockouts = Counter.with({
  name: "message_store_lockouts_total",
  help: "Number of times messages were blocked due to store being locked",
});

export const messageStoreSize = Counter.with({
  name: "message_store_messages_total",
  help: "Total number of messages in the store",
});

export const vestaboardApiErrors = Counter.with({
  name: "vestaboard_api_errors_total",
  help: "Number of Vestaboard API errors",
  labels: ["operation"], // operation can be 'send', 'format', 'getCurrentState'
});

// Initialize clients
const vc = new VestaboardClient(vestaboardApiKey!, isDev);
const apiRouter = new Router({ prefix: "/api" });
const metricsRouter = new Router();
const contentFilter = new ContentFilter(openAiKey);
const messageStore = new MessageStore();
const _jetstream = initializeJetstream(messageStore, vc, contentFilter);
const app = new Application();
const metricsApp = new Application();

app.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    const ms = Date.now() - start;
    const path = ctx.request.url.pathname;
    const method = ctx.request.method;
    const status = ctx.response.status;

    // Record metrics
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
      const record = messageStore.addMessage({
        grid: formatted,
        source: "hello",
      });
      await vc.sendMessage(formatted);
      messagesSentTotal.labels({ source: "hello" }).inc();
      messageStoreSize.inc();
      ctx.response.body = { message: "🔭", id: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "send" }).inc();
      throw error;
    }
  })
  .get("/board/current", async (ctx) => {
    const currentState = await vc.getCurrentState();
    const lastMessage = messageStore.getLatest();
    const isLocked = messageStore.isLocked();

    ctx.response.body = {
      grid: currentState || Array(6).fill().map(() => Array(22).fill(0)),
      lastMessage,
      isLocked,
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
    await vc.sendMessage(message.grid);
    ctx.response.body = { status: "success", message };
  })
  .post("/webhook", async (ctx) => {
    if (messageStore.isLocked()) {
      messageStoreLockouts.inc();
      const lock = messageStore.getCurrentLock()!;
      ctx.response.status = Status.Locked;
      ctx.response.body = {
        error: "Board is currently locked",
        lockedUntil: lock.until,
        reason: lock.reason,
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
      const record = messageStore.addMessage({
        grid: formatted,
        source: "webhook",
        metadata: { event: body },
      });

      await vc.sendMessage(formatted);
      messagesSentTotal.labels({ source: "webhook" }).inc();
      messageStoreSize.inc();

      ctx.response.status = Status.OK;
      ctx.response.body = { status: "success", id: record.id };
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "send" }).inc();
      throw error;
    }
  })
  .post("/board/send", async (ctx) => {
    const { grid, lock } = await ctx.request.body.json();

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

    // Validate lock if present
    if (lock) {
      if (
        typeof lock.duration !== "number" ||
        lock.duration < 1 ||
        lock.duration > 60 ||
        (lock.reason && typeof lock.reason !== "string")
      ) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Invalid lock parameters" };
        return;
      }
    }

    const record = messageStore.addMessage({
      grid,
      source: "custom",
      locked: lock
        ? {
          until: new Date(Date.now() + lock.duration * 60000),
          reason: lock.reason,
        }
        : undefined,
    });

    await vc.sendMessage(grid);
    ctx.response.status = Status.OK;
    ctx.response.body = { status: "success", id: record.id };
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
      console.log(`Serving static file: ${ctx.request.url.pathname}`);
      await ctx.send({
        root: `${Deno.cwd()}/static`,
        index: "index.html",
      });
      console.log("Static file served successfully");
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

await Promise.all([
  app.listen({ port }),
  metricsApp.listen({ port: 9001, hostname: "0.0.0.0" }),
]);
