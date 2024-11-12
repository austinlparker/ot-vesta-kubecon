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
export const messagesSentTotal = meter.createCounter("messages_sent_total", {
  description: "Total number of messages sent to Vestaboard",
  unit: "1",
});

export const messageStoreLockouts = meter.createCounter("message_store_lockouts_total", {
  description: "Number of times messages were blocked due to store being locked",
  unit: "1",
});

export const messageStoreSize = meter.createUpDownCounter("message_store_size", {
  description: "Current number of messages in the store",
  unit: "1",
});

export const vestaboardApiErrors = meter.createCounter("vestaboard_api_errors_total", {
  description: "Number of Vestaboard API errors",
  unit: "1",
});

export const messageQueueSize = meter.createUpDownCounter("message_queue_size", {
  description: "Number of messages waiting to be sent",
  unit: "1",
});

export const messageSendFailures = meter.createCounter("message_send_failures_total", {
  description: "Number of failed message send attempts",
  unit: "1",
});
