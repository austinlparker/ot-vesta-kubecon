import { Counter, Gauge } from "https://deno.land/x/ts_prometheus/mod.ts";
import { CredentialManager, XRPC } from "@atcute/client";
import { Jetstream } from "@skyware/jetstream";
import { MessageStore } from "./message_store.ts";
import { VestaboardClient } from "./vesta.ts";
import "@atcute/bluesky/lexicons";
import { ContentFilter } from "./mod.ts";

const manager = new CredentialManager({ service: "https://bsky.social" });
const rpc = new XRPC({ handler: manager });

interface RateLimitError extends Error {
  status?: number;
  headers?: {
    "ratelimit-reset"?: string;
    "ratelimit-remaining"?: string;
  };
}

async function loginWithRetry(
  manager: CredentialManager,
  credentials: { identifier: string; password: string },
  maxAttempts = 5,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await manager.login(credentials);

      console.log("Successfully logged in to Bluesky");
      return;
    } catch (error) {
      // Cast error to our interface
      const rateLimitError = error as RateLimitError;

      if (rateLimitError.status === 429) {
        // Get reset time from headers
        const resetTimestamp =
          parseInt(rateLimitError.headers?.["ratelimit-reset"] || "0") * 1000;
        const now = Date.now();
        const waitTime = Math.max(resetTimestamp - now, 0);

        console.warn(
          `Rate limit exceeded. Waiting until rate limit reset: ${new Date(resetTimestamp).toISOString()
          }`,
        );

        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue; // Try again after waiting
        }
      }

      // For non-rate-limit errors or if we can't get reset time, use exponential backoff
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to login after ${maxAttempts} attempts: ${error}`,
        );
      }

      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      console.warn(
        `Login attempt ${attempt} failed, retrying in ${delayMs / 1000
        } seconds:`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

await loginWithRetry(manager, {
  identifier: Deno.env.get("BSKY_USERNAME")!,
  password: Deno.env.get("BSKY_PASSWORD")!,
});

const wsConnectionState = Gauge.with({
  name: "bluesky_websocket_connection_state",
  help: "WebSocket connection state (0=disconnected, 1=connected)",
});

const wsMessageCounter = Counter.with({
  name: "bluesky_messages_total",
  help: "Total number of messages received from Bluesky",
  labels: ["collection"],
});

const wsReconnectCounter = Counter.with({
  name: "bluesky_reconnections_total",
  help: "Number of WebSocket reconnection attempts",
});

const contentFilterCounter = Counter.with({
  name: "content_filter_total",
  help: "Content filter results",
  labels: ["result"],
});

const hashtagMatchCounter = Counter.with({
  name: "bluesky_hashtag_matches_total",
  help: "Total number of posts matching tracked hashtags",
  labels: ["category"],
});

const lockedStoreSkips = Counter.with({
  name: "bluesky_locked_store_skips_total",
  help: "Number of matched posts skipped due to locked message store",
});

const TRACKED_HASHTAGS = [
  ["kubecon", "kubeconslc", "kubecon24"],
  ["opentelemetry", "otel"],
  ["otelobservatory", "otelatkubecon"],
] as const;

function containsTrackedHashtag(
  text: string,
): { matched: boolean; categories: string[] } {
  const normalizedText = text.toLowerCase();
  const matchedCategories: string[] = [];

  // Check each category of hashtags
  if (
    TRACKED_HASHTAGS[0].some((tag) =>
      normalizedText.includes(`#${tag.toLowerCase()}`)
    )
  ) {
    matchedCategories.push("kubecon");
  }
  if (
    TRACKED_HASHTAGS[1].some((tag) =>
      normalizedText.includes(`#${tag.toLowerCase()}`)
    )
  ) {
    matchedCategories.push("opentelemetry");
  }
  if (
    TRACKED_HASHTAGS[2].some((tag) =>
      normalizedText.includes(`#${tag.toLowerCase()}`)
    )
  ) {
    matchedCategories.push("otelobservatory");
  }

  return {
    matched: matchedCategories.length > 0,
    categories: matchedCategories,
  };
}

class CustomJetstream {
  private ws: WebSocket;
  private handlers: Map<string, (data: any) => void> = new Map();
  private url: URL;

  constructor(options: {
    wantedCollections: string[];
    endpoint?: string;
  }) {
    this.url = new URL(
      options.endpoint ?? "wss://jetstream1.us-east.bsky.network/subscribe",
    );
    options.wantedCollections?.forEach((collection) => {
      this.url.searchParams.append("wantedCollections", collection);
    });

    this.initializeWebSocket();
  }

  private initializeWebSocket() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      wsConnectionState.set(1);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (
          data.kind === "commit" &&
          data.commit?.collection &&
          data.commit?.operation
        ) {
          const collection = data.commit.collection;
          wsMessageCounter.labels({ collection }).inc();

          const handler = this.handlers.get(collection);
          if (handler) {
            handler({
              did: data.did,
              commit: data.commit,
              time_us: data.time_us,
            });
          }
        }
      } catch (error) {
        console.error("[CustomJetstream] Error processing message:", error);
      }
    };

    this.ws.onclose = () => {
      wsConnectionState.set(0);
      wsReconnectCounter.inc();
      setTimeout(() => this.initializeWebSocket(), 5000);
    };
  }

  on(collection: string, handler: (data: any) => void) {
    this.handlers.set(collection, handler);
  }

  start() {
    wsConnectionState.set(0);
  }

  close() {
    this.ws.close();
  }
}

export async function hydrateMatchedPost(event: any) {
  const { data } = await rpc.get("app.bsky.actor.getProfile", {
    params: {
      actor: event.did,
    },
  });
  return {
    handle: data.handle,
    displayName: data.displayName,
    postText: event.commit.record.text,
  };
}

export function initializeJetstream(
  messageStore: MessageStore,
  vc: VestaboardClient,
  contentFilter: ContentFilter,
) {
  const jetstream = new CustomJetstream({
    wantedCollections: ["app.bsky.feed.post"],
  });

  jetstream.on("app.bsky.feed.post", async (event) => {
    if (event.commit.operation === "create") {
      wsMessageCounter.labels({ collection: "app.bsky.feed.post" }).inc();
      const postText = event.commit.record.text;
      const hashtagMatch = containsTrackedHashtag(postText);

      if (hashtagMatch.matched) {
        console.log("Matched hashtag in post:", postText);
        hashtagMatch.categories.forEach((category) => {
          hashtagMatchCounter.labels({ category }).inc();
        });

        try {
          // Check content appropriateness
          const contentCheck = await contentFilter.isAppropriate(postText);

          if (!contentCheck.isAcceptable) {
            contentFilterCounter.labels({ result: "rejected" }).inc();
            console.log(
              `Filtered out inappropriate content: ${contentCheck.reason}`,
            );
            return;
          }
          contentFilterCounter.labels({ result: "accepted" }).inc();

          const hydratedPost = await hydrateMatchedPost(event);
          const sanitizedPost = {
            ...hydratedPost,
            postText: contentCheck.filteredText || hydratedPost.postText,
          };

          const message = await vc.formatBlueskyPost(sanitizedPost);

          if (!messageStore.isLocked()) {
            const record = messageStore.addMessage({
              grid: message,
              source: "bluesky",
              metadata: {
                post: sanitizedPost,
                matchedAt: new Date().toISOString(),
                moderation: {
                  filtered: postText !== contentCheck.filteredText,
                  originalText: postText,
                  matchedHashtags: hashtagMatch.categories,
                },
              },
            });

            await vc.sendMessage(message);
            console.log(`Sent Bluesky post to Vestaboard: ${record.id}`);
          } else {
            lockedStoreSkips.inc();
            console.log("Message store is locked, skipping display");
          }
        } catch (error) {
          console.error("Error processing Bluesky post:", error);
        }
      }
    }
  });
  return jetstream;
}
