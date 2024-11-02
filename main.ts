import { Application, Router } from "@oak/oak";
import { VestaboardClient } from "./vesta.ts";
import { handleWebhookEvent } from "./handler.ts";
import { type WebhookEvent } from "@octokit/webhooks-types";

const isDev = Deno.env.get("DEV_MODE") === "true";
const vestaboardApiKey = isDev
  ? "fake-key"
  : Deno.env.get("VESTABOARD_API_KEY");

if (!isDev && !vestaboardApiKey) {
  console.error("VESTABOARD_API_KEY is required in production mode");
  Deno.exit(1);
}

const vc = new VestaboardClient(vestaboardApiKey!, isDev);
const router = new Router();

router.get("/", async (ctx) => {
  await vc.formatAndSendMessage(VestaboardClient.createTelescope());
  ctx.response.body = "🔭";
});

router.post("/webhook", async (ctx) => {
  const body = await ctx.request.body.json();
  const message = handleWebhookEvent(body as WebhookEvent);

  if (!message) {
    ctx.response.status = 204;
    console.log("Unhandled webhook event");
    return;
  }

  await vc.formatAndSendMessage(message);
  ctx.response.status = 200;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: 3000 });
