import { Application, Router } from "jsr:@oak/oak";
import { isHttpError } from "jsr:@oak/commons/http_errors";
import { Status } from "jsr:@oak/commons/status";
import { VestaboardClient } from "./vesta.ts";
import { handleWebhookEvent } from "./handler.ts";
import type { WebhookEvent } from "@octokit/webhooks-types";
import { MessageStore } from "./message_store.ts";

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
const apiRouter = new Router({ prefix: "/api" });
const messageStore = new MessageStore();
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

// API Routes
apiRouter
  .get("/hello", async (ctx) => {
    const message = VestaboardClient.createTelescope();
    const formatted = await vc.formatMessage(message);

    const record = messageStore.addMessage({
      grid: formatted,
      source: "hello",
    });

    await vc.sendMessage(formatted);
    ctx.response.body = { message: "🔭", id: record.id };
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
      const lock = messageStore.getCurrentLock()!;
      ctx.response.status = Status.Locked;
      ctx.response.body = {
        error: "Board is currently locked",
        lockedUntil: lock.until,
        reason: lock.reason,
      };
      return;
    }
    const body = await ctx.request.body.json();
    const message = handleWebhookEvent(body as WebhookEvent);

    if (!message) {
      ctx.response.status = Status.NoContent;
      console.log("Unhandled webhook event");
      return;
    }

    const formatted = await vc.formatMessage(message);
    const record = messageStore.addMessage({
      grid: formatted,
      source: "webhook",
      metadata: { event: body },
    });

    await vc.sendMessage(formatted);
    ctx.response.status = Status.OK;
    ctx.response.body = { status: "success", id: record.id };
  })
  .post("/board/send", async (ctx) => {
      const { grid, lock } = await ctx.request.body.json();

      // Validate grid structure
      if (!Array.isArray(grid) ||
          grid.length !== 6 ||
          !grid.every(row => Array.isArray(row) &&
          row.length === 22 &&
          row.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= 71))) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { error: "Invalid grid format" };
        return;
      }

      // Validate lock if present
      if (lock) {
        if (typeof lock.duration !== 'number' ||
            lock.duration < 1 ||
            lock.duration > 60 ||
            (lock.reason && typeof lock.reason !== 'string')) {
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
app.use(apiRouter.routes());
app.use(apiRouter.allowedMethods());

// Static file serving (after API routes)
app.use(async (ctx, next) => {
  if (
    ctx.request.method === "GET" && !ctx.request.url.pathname.startsWith("/api")
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

app.addEventListener("listen", ({ hostname, port, secure }) => {
  console.log(
    `🚀 Server listening on: ${secure ? "https://" : "http://"}${
      hostname ?? "localhost"
    }:${port}`,
  );
});

await app.listen({ port });
