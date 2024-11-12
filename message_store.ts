import {
  messageQueueSize,
  messageSendFailures,
  messageStoreSize,
  unsentMessagesGauge,
  oldestUnsentMessageAge,
} from "./metrics.ts";

export interface MessageRecord {
  id: string;
  grid: number[][];
  timestamp: Date;
  source: "webhook" | "custom" | "hello" | "bluesky";
  metadata?: Record<string, unknown>;
  sent?: boolean;
  sendAttempts?: number;
}

export interface StoreState {
  locked: boolean;
  lockReason?: string;
  queuePaused: boolean;
}

export class MessageStore {
  private messages: MessageRecord[] = [];
  private state: StoreState = {
    locked: false,
    queuePaused: false,
  };
  private maxHistory: number;
  private maxRetries: number;

  constructor(maxHistory = 50, maxRetries = 3) {
    this.maxHistory = maxHistory;
    this.maxRetries = maxRetries;
    messageStoreSize.set(0);
    messageQueueSize.set(0);
    unsentMessagesGauge.set(0);
    oldestUnsentMessageAge.set(0);
  }

  private updateUnsentMetrics(): void {
    const unsentMessages = this.messages.filter(m => !m.sent);
    unsentMessagesGauge.set(unsentMessages.length);

    // Update oldest unsent message age
    const oldestUnsent = unsentMessages[unsentMessages.length - 1];
    if (oldestUnsent) {
      const ageInSeconds = (new Date().getTime() - oldestUnsent.timestamp.getTime()) / 1000;
      oldestUnsentMessageAge.set(ageInSeconds);
    } else {
      oldestUnsentMessageAge.set(0);
    }
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
    this.updateUnsentMetrics()

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
      this.updateUnsentMetrics()
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

  getState(): StoreState {
    return { ...this.state };
  }

  lock(reason?: string): void {
    this.state.locked = true;
    this.state.lockReason = reason;
  }

  unlock(): void {
    this.state.locked = false;
    this.state.lockReason = undefined;
  }

  pauseQueue(): void {
    this.state.queuePaused = true;
  }

  resumeQueue(): void {
    this.state.queuePaused = false;
  }

  pushToFront(message: MessageRecord): void {
    this.messages = this.messages.filter(m => m.id !== message.id);
    this.messages.unshift(message);

    // Update all relevant metrics
    messageStoreSize.set(this.messages.length);
    this.updateUnsentMetrics();
  }

  isLocked(): boolean {
    return this.state.locked;
  }

  isQueuePaused(): boolean {
    return this.state.queuePaused;
  }
}
