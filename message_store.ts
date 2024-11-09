export interface MessageRecord {
  id: string;
  grid: number[][];
  timestamp: Date;
  source: "webhook" | "custom" | "hello";
  metadata?: Record<string, unknown>;
  locked?: {
    until: Date;
    reason?: string;
  };
}

export class MessageStore {
  private messages: MessageRecord[] = [];
  private maxHistory: number;

  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
  }

  addMessage(message: Omit<MessageRecord, "id" | "timestamp">): MessageRecord {
    const record: MessageRecord = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    this.messages.unshift(record);

    if (this.messages.length > this.maxHistory) {
      this.messages = this.messages.slice(0, this.maxHistory);
    }

    return record;
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

    // Check if lock has expired
    if (new Date() > latest.locked.until) {
      // Remove the lock
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
