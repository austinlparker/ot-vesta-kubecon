import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("ot-vesta-kubecon");

// HTTP metrics
export const httpRequestsTotal = meter.createCounter("http_requests_total", {
  description: "Total number of HTTP requests",
  unit: "1",
});

export const httpRequestDuration = meter.createHistogram("http_request_duration_seconds", {
  description: "HTTP request duration in seconds",
  unit: "s",
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

export const messageStoreSize = meter.createObservableGauge("message_store_size", {
  description: "Current number of messages in the store",
  unit: "1",
});

export const vestaboardApiErrors = meter.createCounter("vestaboard_api_errors_total", {
  description: "Number of Vestaboard API errors",
  unit: "1",
});

export const messageQueueSize = meter.createObservableGauge("message_queue_size", {
  description: "Number of messages waiting to be sent",
  unit: "1",
});

export const messageSendFailures = meter.createCounter("message_send_failures_total", {
  description: "Number of failed message send attempts",
  unit: "1",
});

export const unsentMessagesGauge = meter.createObservableGauge("unsent_message_gauge", {
  description: "Number of unsent messages",
  unit: "1",
});

export const oldestUnsentMessageAge = meter.createObservableGauge("oldest_unsent_message_age_seconds", {
  description: "Age of oldest unsent message",
  unit: "s",
});

export const queuePauseTotal = meter.createCounter("queue_pause_total", {
  description: "Number of times the message queue was paused",
  unit: "1",
});