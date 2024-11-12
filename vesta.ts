import { messagesSentTotal, vestaboardApiErrors } from "./metrics.ts";
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
  private readonly config: Required<VestaboardConfig>;
  private readonly rateLimiter: RateLimiter;
  private readonly messageStore: MessageStore;
  private processingInterval: number | undefined;

  private static readonly DEFAULT_CONFIG: Omit<
    Required<VestaboardConfig>,
    "apiKey"
  > = {
      devMode: false,
      baseUrl: "https://rw.vestaboard.com",
      queueInterval: 30000, // 30 seconds
      retryAttempts: 3,
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
    if (this.processingInterval) return;

    console.log(
      `Starting message queue processor (interval: ${this.config.queueInterval}ms)`,
    );

    this.processingInterval = setInterval(() => {
      this.processNextMessage().catch((error) => {
        console.error("Error processing message queue:", error);
      });
    }, this.config.queueInterval);
  }

  stopProcessingQueue(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  private async processNextMessage(): Promise<void> {
    if (this.messageStore.isQueuePaused()) {
      return;
    }

    const message = this.messageStore.getNextUnsent();
    if (!message) return;

    try {
      await this.sendMessage(message.grid);
      this.messageStore.markAsSent(message.id);
      messagesSentTotal.labels({ source: message.source }).inc();
    } catch (error) {
      this.messageStore.markSendAttempt(message.id);
      vestaboardApiErrors.labels({ operation: "send" }).inc();
      throw error;
    }
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        return await operation();
      } catch (error) {
        if (attempt === this.config.retryAttempts - 1) throw error;
        console.warn(`Attempt ${attempt + 1} failed, retrying...`, error);
      }
    }
    throw new Error("Should not reach here");
  }

  async formatMessage(message: VBMLMessage): Promise<VestaboardMessage> {
    try {
      return this.retryWithBackoff(async () => {
        const response = await fetch(VestaboardClient.VBML_URL, {
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          throw new Error(`VBML formatting failed: ${response.statusText}`);
        }

        return response.json();
      });
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "format" }).inc();
      throw error;
    }
  }

  async formatBlueskyPost(
    hydratedPost: { displayName: string; handle: string; postText: string },
  ): Promise<VestaboardMessage> {
    const maxLength = 22;
    // Truncate texts, leaving room for the blue square in username line
    const displayName = hydratedPost.displayName.slice(0, maxLength - 1); // -1 for square only
    const handle = hydratedPost.handle.slice(0, maxLength - 1); // -1 for @ symbol
    const truncatedText = hydratedPost.postText.slice(0, maxLength * 3); // Allow for 3 lines of text

    const message: VBMLMessage = {
      components: [
        // Header: Blue square + username (no extra space)
        {
          template: `{67}${displayName}`, // Removed the space after the square
          style: {
            height: 1,
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 0 },
          },
        },
        // Handle with @ prefix
        {
          template: `@${handle}`,
          style: {
            height: 1,
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 1 },
          },
        },
        // Empty line is handled by positioning
        // Post text
        {
          template: truncatedText,
          style: {
            height: 3, // Allow up to 3 lines for the post text
            width: maxLength,
            justify: "left",
            absolutePosition: { x: 0, y: 3 },
          },
        },
      ],
    };

    return this.formatMessage(message);
  }

  private async sendMessage(message: VestaboardMessage): Promise<void> {
    if (this.config.devMode) {
      console.log("DEV MODE: Would send message to Vestaboard:");
      this.prettyPrintVestaboard(message);
      return;
    }

    await this.retryWithBackoff(async () => {
      await this.rateLimiter.waitForNextSlot();

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
    });
  }

  async formatAndSendMessage(message: VBMLMessage): Promise<void> {
    const formattedMessage = await this.formatMessage(message);
    await this.sendMessage(formattedMessage);
  }

  async queueMessage(
    message: VestaboardMessage,
    source: MessageRecord["source"],
    metadata?: Record<string, unknown>,
  ): Promise<MessageRecord> {
    return this.messageStore.addMessage({
      grid: message,
      source,
      metadata,
    });
  }

  async getCurrentState(): Promise<VestaboardMessage> {
    try {
      const response = await fetch(`${this.config.baseUrl}/`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Vestaboard-Read-Write-Key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to get current state: ${response.statusText}`,
        );
      }

      const data = await response.json();
      try {
        return JSON.parse(data.currentMessage.layout);
      } catch (error) {
        throw new Error(`Invalid response format: ${error.message}`);
      }
    } catch (error) {
      vestaboardApiErrors.labels({ operation: "getCurrentState" }).inc();
      throw error;
    }
  }

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

  static createEventHeader(
    eventType: "star" | "issue" | "pull_request",
    timestamp: Date,
  ): VBMLMessage {
    const headers: Record<string, { text: string; color: number }> = {
      star: { text: "STARRED", color: 65 }, // Yellow
      issue: { text: "ISSUE OPENED", color: 63 }, // Red
      pull_request: { text: "PR CLOSED", color: 66 }, // Green
    };

    const header = headers[eventType];
    const time = timestamp.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    return {
      components: [{
        template: `{${header.color}}${header.text}`,
        style: {
          height: 1,
          width: 12,
          absolutePosition: { x: 0, y: 0 },
        },
      }, {
        template: time,
        style: {
          height: 1,
          width: 10,
          justify: "right",
          absolutePosition: { x: 12, y: 0 },
        },
      }],
    };
  }

  // Create the main content section
  static createMainContent(content: string): VBMLMessage {
    return {
      components: [{
        template: content,
        style: {
          height: 3,
          justify: "center",
          align: "center",
          absolutePosition: { x: 0, y: 1 },
        },
      }],
    };
  }

  // Create the footer with repo and user
  static createFooter(repoName: string, userLogin: string): VBMLMessage {
    return {
      components: [{
        template: repoName,
        style: {
          height: 1,
          justify: "right",
          absolutePosition: { x: 0, y: 4 },
        },
      }, {
        template: userLogin,
        style: {
          height: 1,
          justify: "right",
          absolutePosition: { x: 0, y: 5 },
        },
      }],
    };
  }

  // Combine all components into a single message
  static createEventMessage(params: {
    eventType: "star" | "issue" | "pull_request";
    timestamp: Date;
    repoName: string;
    userLogin: string;
    mainContent: string;
  }): VBMLMessage {
    return {
      components: [
        ...this.createEventHeader(params.eventType, params.timestamp)
          .components,
        ...this.createMainContent(params.mainContent).components,
        ...this.createFooter(params.repoName, params.userLogin).components,
      ],
    };
  }

  static createTelescope(): VBMLMessage {
    // 67 blue
    // 65 yellow
    return {
      components: [
        {
          rawCharacters: [
            [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
            [
              0,
              0,
              0,
              65,
              65,
              0,
              0,
              0,
              0,
              67,
              67,
              0,
              0,
              67,
              67,
              0,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
            [
              0,
              0,
              0,
              65,
              65,
              65,
              65,
              0,
              67,
              67,
              67,
              67,
              67,
              67,
              67,
              67,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
            [
              0,
              0,
              0,
              65,
              65,
              65,
              65,
              0,
              67,
              67,
              67,
              65,
              65,
              65,
              67,
              67,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
            [
              0,
              0,
              0,
              65,
              65,
              0,
              0,
              0,
              0,
              67,
              0,
              65,
              0,
              65,
              0,
              67,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
            [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              65,
              65,
              65,
              0,
              0,
              0,
              65,
              65,
              0,
              0,
              0,
            ],
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
