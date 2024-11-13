import { messagesSentTotal, vestaboardApiErrors, messageSendFailures } from "./metrics.ts";
import { MessageStore, MessageRecord } from "./message_store.ts";
import { CHARACTER_MAP } from "./util.ts";

interface Position {
  x: number;
  y: number;
}

interface VBMLStyle {
  height?: 1 | 2 | 3 | 4 | 5 | 6;
  width?: number;
  justify?: "left" | "right" | "center" | "justified";
  align?: "top" | "bottom" | "center" | "justified";
  absolutePosition?: Position;
}

interface VBMLComponent {
  template?: string;
  rawCharacters?: number[][];
  style?: VBMLStyle;
}

export interface VBMLMessage {
  props?: Record<string, string>;
  components: VBMLComponent[];
}

export type VestaboardMessage = number[][];

interface VestaboardConfig {
  apiKey: string;
  devMode?: boolean;
  baseUrl?: string;
  queueInterval?: number;
  retryAttempts?: number;
  rateLimitMs?: number;
}

class AsyncLock {
  private locked = false;
  private queue: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    const currentQueue = this.queue;
    let release!: () => void;

    this.queue = this.queue.then(() =>
      new Promise((resolve) => {
        release = resolve;
      })
    );

    await currentQueue;
    this.locked = true;

    return () => {
      this.locked = false;
      release();
    };
  }
}

class RateLimiter {
  private lastRequestTime: number = 0;
  private readonly minInterval: number;
  private readonly lock = new AsyncLock();

  constructor(minInterval: number) {
    this.minInterval = minInterval;
  }

  async waitForNextSlot(): Promise<void> {
    const release = await this.lock.acquire();
    try {
      const now = Date.now();
      const timeToWait = Math.max(
        0,
        this.lastRequestTime + this.minInterval - now,
      );

      if (timeToWait > 0) {
        await new Promise((resolve) => setTimeout(resolve, timeToWait));
      }

      this.lastRequestTime = Date.now();
    } finally {
      release();
    }
  }
}

export class VestaboardClient {
  private static readonly MAX_RETRIES = 2; // Hard limit of 2 attempts
  private readonly config: Required<VestaboardConfig>;
  private readonly rateLimiter: RateLimiter;
  private messageStore: MessageStore;
  private processingMessage: boolean = false;
  private queueTimer?: number;
  private lastSendTime?: number;

  private static readonly DEFAULT_CONFIG: Omit<Required<VestaboardConfig>, "apiKey"> = {
    devMode: false,
    baseUrl: "https://rw.vestaboard.com",
    queueInterval: 30000, // 30 seconds
    retryAttempts: 2, // Align with MAX_RETRIES
    rateLimitMs: 15000, // 15 seconds
  };

  private static readonly VBML_URL = "https://vbml.vestaboard.com/compose";

  constructor(
    config: VestaboardConfig,
    messageStore: MessageStore,
  ) {
    this.config = {
      ...VestaboardClient.DEFAULT_CONFIG,
      ...config,
    };
    this.config.baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    this.messageStore = messageStore;
    this.rateLimiter = new RateLimiter(this.config.rateLimitMs);
  }

  private prettyPrintVestaboard(message: VestaboardMessage): void {
    const TOP_BORDER = "┌─────────────────────────────────────────────┐";
    const BOTTOM_BORDER = "└─────────────────────────────────────────────┘";
    const SIDE_BORDER = "│";
    const SPACE_CHAR = "▢";

    console.log("\n" + TOP_BORDER);

    message.forEach((row) => {
      const chars = row.map((code) =>
        code === 0 ? SPACE_CHAR : CHARACTER_MAP[code] || SPACE_CHAR
      );
      const displayText = chars.join(" ").padEnd(43, " ");
      console.log(`${SIDE_BORDER} ${displayText} ${SIDE_BORDER}`);
    });

    console.log(BOTTOM_BORDER + "\n");
  }

  startProcessingQueue(): void {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
    }

    this.queueTimer = setInterval(() => {
      this.processQueue().catch(console.error);
    }, this.config.queueInterval);

    // Start processing immediately
    this.processQueue().catch(console.error);
  }

  stopProcessingQueue(): void {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = undefined;
    }
  }

  private async processQueue() {
    if (this.processingMessage || this.messageStore.isQueuePaused()) {
      return;
    }

    try {
      this.processingMessage = true;
      const nextMessage = this.messageStore.getNextUnsent();

      if (!nextMessage) {
        return;
      }

      // Respect rate limiting
      const now = Date.now();
      if (this.lastSendTime && (now - this.lastSendTime) < this.config.rateLimitMs) {
        return;
      }

      console.log(`Processing message ${nextMessage.id} from source: ${nextMessage.source}`);

      try {
        await this.rateLimiter.waitForNextSlot();
        await this.sendMessage(nextMessage.grid);
        this.messageStore.markAsSent(nextMessage.id);
        this.lastSendTime = now;
        messagesSentTotal.labels({ source: nextMessage.source }).inc();
      } catch (error) {
        console.error(`Failed to send message ${nextMessage.id}:`, error);
        this.messageStore.markSendAttempt(nextMessage.id);
        vestaboardApiErrors.labels({ operation: "send" }).inc();

        // If this was the second attempt, remove from queue
        if (nextMessage.sendAttempts && nextMessage.sendAttempts >= VestaboardClient.MAX_RETRIES - 1) {
          console.error(`Message ${nextMessage.id} failed twice, removing from queue`);
          messageSendFailures.inc();
          this.messageStore.removeFromQueue(nextMessage.id);
        }
      }
    } finally {
      this.processingMessage = false;
    }
  }

  async queueMessage(
    grid: number[][],
    source: MessageRecord["source"],
    metadata?: Record<string, unknown>
  ): Promise<MessageRecord> {
    if (this.messageStore.isLocked()) {
      throw new Error("Message store is locked");
    }

    return this.messageStore.addMessage({
      grid,
      source,
      metadata
    });
  }

  async formatMessage(message: VBMLMessage): Promise<VestaboardMessage> {
    const response = await fetch(VestaboardClient.VBML_URL, {
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      vestaboardApiErrors.labels({ operation: "format" }).inc();
      throw new Error(`VBML formatting failed: ${response.statusText}`);
    }

    return response.json();
  }

  private async sendMessage(message: VestaboardMessage): Promise<void> {
    if (this.config.devMode) {
      console.log("DEV MODE: Would send message to Vestaboard:");
      this.prettyPrintVestaboard(message);
      return;
    }

    const response = await fetch(`${this.config.baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vestaboard-Read-Write-Key": this.config.apiKey,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  }

  async getCurrentState(): Promise<VestaboardMessage | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Vestaboard-Read-Write-Key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get current state: ${response.statusText}`);
      }

      const data = await response.json();
      try {
        return JSON.parse(data.currentMessage.layout);
      } catch (error) {
        console.error("Failed to parse current message layout:", error);
        return null;
      }
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "getCurrentState" }).inc();
      console.error("Failed to get current state:", error);
      return null;
    }
  }

  // Utility methods for creating messages
  static createCenteredMessage(text: string): VBMLMessage {
    return {
      components: [
        {
          template: text,
          style: {
            justify: "center",
            align: "center",
            width: 22,
            height: 6,
          },
        },
      ],
    };
  }

  // Create a Bluesky post format
  async formatBlueskyPost(
    hydratedPost: { displayName: string; handle: string; postText: string },
  ): Promise<VestaboardMessage> {
    const maxLength = 22;
    const displayName = hydratedPost.displayName.slice(0, maxLength - 1);
    const handle = hydratedPost.handle.slice(0, maxLength - 1);
    const truncatedText = hydratedPost.postText.slice(0, maxLength * 3);

    const message: VBMLMessage = {
      components: [
        {
          template: `{67}${displayName}`,
          style: {
            height: 1,
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 0 },
          },
        },
        {
          template: `@${handle}`,
          style: {
            height: 1,
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 1 },
          },
        },
        {
          template: truncatedText,
          style: {
            height: 3,
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 3 },
          },
        },
      ],
    };

    return this.formatMessage(message);
  }

  static createTelescope(): VBMLMessage {
    return {
      components: [
        {
          rawCharacters: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 65, 0, 0, 0],
            [0, 0, 0, 65, 65, 0, 0, 0, 0, 67, 67, 0, 0, 67, 67, 0, 0, 65, 65, 0, 0, 0],
            [0, 0, 0, 65, 65, 65, 65, 0, 67, 67, 67, 67, 67, 67, 67, 67, 0, 65, 65, 0, 0, 0],
            [0, 0, 0, 65, 65, 65, 65, 0, 67, 67, 67, 65, 65, 65, 67, 67, 0, 65, 65, 0, 0, 0],
            [0, 0, 0, 65, 65, 0, 0, 0, 0, 67, 0, 65, 0, 65, 0, 67, 0, 65, 65, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 65, 65, 65, 0, 0, 0, 65, 65, 0, 0, 0],
          ],
          style: {
            height: 6,
            width: 22,
            absolutePosition: { x: 0, y: 0 },
          },
        },
      ],
    };
  }
}
