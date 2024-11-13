import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
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
  private db: DB;
  private state: StoreState = {
    locked: false,
    queuePaused: false,
  };
  private maxHistory: number;
  private maxRetries: number;

  private static readonly MAX_RETRIES = 2; // Match VestaboardClient

  constructor(dbPath = "./messages.db", maxRetries = 3) {
    this.db = new DB(dbPath);
    this.maxRetries = maxRetries;
    this.initializeDatabase();
    this.initializeMetrics();
  }

  private initializeDatabase(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        grid TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        metadata TEXT,
        sent BOOLEAN DEFAULT FALSE,
        sendAttempts INTEGER DEFAULT 0
      )
    `);
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
        )
    `);
    const state = this.loadState();
    if (!state) {
      this.saveState(this.state)
    } else {
      this.state = state;
    }
  }

  private initializeMetrics(): void {
    messageStoreSize.set(0);
    messageQueueSize.set(0);
    unsentMessagesGauge.set(0);
    oldestUnsentMessageAge.set(0);
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const totalCount = this.db.query<[number]>(
      "SELECT COUNT(*) FROM messages"
    )[0][0];
    const unsentCount = this.db.query<[number]>(
      "SELECT COUNT(*) FROM messages WHERE sent = FALSE"
    )[0][0];

    messageStoreSize.set(totalCount);
    messageQueueSize.set(unsentCount);
    unsentMessagesGauge.set(unsentCount);

    // Update oldest unsent message age
    const oldestUnsent = this.db.query<[number]>(
      "SELECT timestamp FROM messages WHERE sent = FALSE ORDER BY timestamp ASC LIMIT 1"
    );

    if (oldestUnsent.length > 0) {
      const ageInSeconds = (Date.now() - oldestUnsent[0][0]) / 1000;
      oldestUnsentMessageAge.set(ageInSeconds);
    } else {
      oldestUnsentMessageAge.set(0);
    }
  }

  private loadState(): StoreState | null {
    const stateRow = this.db.query<[string]>(
      "SELECT value FROM state WHERE key = 'appState'"
    );
    if (stateRow.length > 0) {
      return JSON.parse(stateRow[0][0]);
    }
    return null;
  }

  private saveState(state: StoreState): void {
    this.db.query(
      "INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)",
      ["appState", JSON.stringify(state)]
    );
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

    this.db.query(
      `INSERT INTO messages (id, grid, timestamp, source, metadata, sent, sendAttempts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        JSON.stringify(record.grid),
        record.timestamp.getTime(),
        record.source,
        JSON.stringify(record.metadata),
        false,
        0,
      ]
    );

    this.updateMetrics();
    return record;
  }


  private rowToRecord(row: [string, string, number, string, string, number, number]): MessageRecord {
    const [id, grid, timestamp, source, metadata, sent, sendAttempts] = row;
    return {
      id,
      grid: JSON.parse(grid),
      timestamp: new Date(timestamp),
      source: source as MessageRecord["source"],
      metadata: metadata ? JSON.parse(metadata) : undefined,
      sent: Boolean(sent),
      sendAttempts,
    };
  }

  markAsSent(id: string): void {
    this.db.query(
      "UPDATE messages SET sent = TRUE WHERE id = ?",
      [id]
    );
    this.updateMetrics();
  }

  markSendAttempt(id: string): void {
    this.db.transaction(() => {
      const [attempts] = this.db.query<[number]>(
        "SELECT sendAttempts FROM messages WHERE id = ?",
        [id]
      )[0];

      const newAttempts = attempts + 1;

      this.db.query(
        "UPDATE messages SET sendAttempts = ? WHERE id = ?",
        [newAttempts, id]
      );

      // If max retries reached, remove from queue
      if (newAttempts >= MessageStore.MAX_RETRIES) {
        this.removeFromQueue(id);
      }
    });
  }

  getLatest(): MessageRecord | undefined {
    const row = this.db.query<[string, string, number, string, string, number, number]>(
      "SELECT * FROM messages ORDER BY timestamp DESC LIMIT 1"
    );
    return row.length > 0 ? this.rowToRecord(row[0]) : undefined;
  }

  getMessage(id: string): MessageRecord | undefined {
    const row = this.db.query<[string, string, number, string, string, number, number]>(
      "SELECT * FROM messages WHERE id = ?",
      [id]
    );
    return row.length > 0 ? this.rowToRecord(row[0]) : undefined;
  }

  getMessages(limit = 10): MessageRecord[] {
    const rows = this.db.query<[string, string, number, string, string, number, number]>(
      "SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?",
      [limit]
    );
    return rows.map(row => this.rowToRecord(row));
  }

  removeFromQueue(id: string): void {
    this.db.transaction(() => {
      this.db.query(
        "UPDATE messages SET sent = TRUE WHERE id = ?",
        [id]
      );
      messageSendFailures.inc();
      this.updateMetrics();
    });
  }

  getNextUnsent(): MessageRecord | undefined {
    const row = this.db.query<[string, string, number, string, string, number, number]>(
      `SELECT id, grid, timestamp, source, metadata, sent, sendAttempts
        FROM messages
        WHERE sent = FALSE
        AND sendAttempts < ?
        ORDER BY timestamp ASC
        LIMIT 1`,
      [MessageStore.MAX_RETRIES]
    );

    if (row.length === 0) return undefined;
    return this.rowToRecord(row[0]);
  }

  getState(): StoreState {
    return { ...this.state };
  }

  lock(reason?: string): void {
    this.state.locked = true;
    this.state.lockReason = reason;
    this.saveState(this.state);
  }

  unlock(): void {
    this.state.locked = false;
    this.state.lockReason = undefined;
    this.saveState(this.state);
  }

  pauseQueue(): void {
    this.state.queuePaused = true;
    this.saveState(this.state)
  }

  resumeQueue(): void {
    this.state.queuePaused = false;
    this.saveState(this.state)
  }

  pushToFront(message: MessageRecord): void {
    this.db.query(
      "UPDATE messages SET timestamp = ? WHERE id = ?",
      [Date.now(), message.id]
    );
    this.updateMetrics();
  }

  isLocked(): boolean {
    return this.state.locked;
  }

  isQueuePaused(): boolean {
    return this.state.queuePaused;
  }

  close(): void {
    this.db.close();
  }
}
