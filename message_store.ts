import {
  messageQueueSize,
  messageSendFailures,
  messageStoreSize,
} from "./metrics.ts";

export interface MessageRecord {
  id: string;
  grid: number[][];
  timestamp: Date;
  source: "webhook" | "custom" | "hello" | "bluesky";
  metadata?: Record<string, unknown>;
  locked?: {
    until: Date;
    reason?: string;
  };
  sent?: boolean;
  sendAttempts?: number;
}

export class MessageStore {
  private messages: MessageRecord[] = [];
  private maxHistory: number;
  private maxRetries: number;

  constructor(maxHistory = 50, maxRetries = 3) {
    this.maxHistory = maxHistory;
    this.maxRetries = maxRetries;
    messageStoreSize.set(0);
    messageQueueSize.set(0);
  }

  // Add message to queue
  addMessage(
    message: Omit<MessageRecord, "id" | "timestamp" | "sent">,
  ): MessageRecord {
    const record: MessageRecord = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      sent: false,
      sendAttempts: 0,
    };

    this.messages.unshift(record);

    messageStoreSize.set(this.messages.length);

    return record;
  }

  getNextUnsent(): MessageRecord | undefined {
    return this.messages.find((m) =>
      !m.sent &&
      (!m.sendAttempts || m.sendAttempts < this.maxRetries)
    );
  }

  markAsSent(id: string): void {
    const message = this.getMessage(id);
    if (message) {
      messageQueueSize.set(this.messages.filter((m) => !m.sent).length);
      message.sent = true;
    }
  }

  markSendAttempt(id: string): void {
    const message = this.getMessage(id);
    if (message) {
      message.sendAttempts = (message.sendAttempts || 0) + 1;
    }
  }

  getLatest(): MessageRecord | undefined {
    return this.messages[0];
  }

  getMessage(id: string): MessageRecord | undefined {
    return this.messages.find((m) => m.id === id);
  }

  getMessages(limit = 10): MessageRecord[] {
    return this.messages.slice(0, limit);
  }

  isLocked(): boolean {
    const latest = this.getLatest();
    if (!latest?.locked) return false;

    if (new Date() > latest.locked.until) {
      delete latest.locked;
      return false;
    }

    return true;
  }

  getCurrentLock(): MessageRecord["locked"] | null {
    if (!this.isLocked()) return null;
    return this.getLatest()?.locked ?? null;
  }
}
