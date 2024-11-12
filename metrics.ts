import {
  Counter,
  Gauge,
  Histogram,
} from "https://deno.land/x/ts_prometheus/mod.ts";

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
  name: "message_store_lockouts_tzotal",
  help: "Number of times messages were blocked due to store being locked",
});

export const messageStoreSize = Gauge.with({
  name: "message_store_size",
  help: "Current number of messages in the store",
});

export const vestaboardApiErrors = Counter.with({
  name: "vestaboard_api_errors_total",
  help: "Number of Vestaboard API errors",
  labels: ["operation"], // operation can be 'send', 'format', 'getCurrentState'
});

export const messageQueueSize = Gauge.with({
  name: "message_queue_size",
  help: "Number of messages waiting to be sent",
});

export const messageSendFailures = Counter.with({
  name: "message_send_failures_total",
  help: "Number of failed message send attempts",
  labels: ["source"],
});

export const unsentMessagesGauge = Gauge.with({
  name: "unsent_message_gauge",
  help: "Number of unsent messages",
});

export const oldestUnsentMessageAge = Gauge.with({
  name: "oldest_unsent_message_age_seconds",
  help: "Age of oldest unsent message",
});

export const queuePauseTotal = Counter.with({
  name: "queue_pause_total",
  help: "Number of times the message queue was paused",
});
