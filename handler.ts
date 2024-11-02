import {
  IssuesOpenedEvent,
  PullRequestClosedEvent,
  StarCreatedEvent,
  WebhookEvent,
} from "@octokit/webhooks-types";
import { VBMLMessage, VestaboardClient } from "./vesta.ts";

export const handleWebhookEvent = (
  event: WebhookEvent,
): VBMLMessage | undefined => {
  if ("issue" in event && event.action === "opened") {
    console.log(`${event.sender.login} opened an issue!`);
    return constructIssueOpenedMessage(event as IssuesOpenedEvent);
  }
  if ("pull_request" in event && event.action === "closed") {
    console.log(`${event.sender.login} closed a pull request!`);
    return constructPullRequestClosedMessage(event as PullRequestClosedEvent);
  }
  if ("starred_at" in event && event.action === "created") {
    console.log(`${event.sender.login} starred the repo!`);
    return constructStarCreatedMessage(event as StarCreatedEvent);
  }
};

const constructIssueOpenedMessage = (event: IssuesOpenedEvent): VBMLMessage => {
  return VestaboardClient.createEventMessage({
    eventType: "issue",
    timestamp: new Date(event.issue.created_at),
    repoName: event.repository.name,
    userLogin: event.sender.login,
    mainContent: event.issue.title,
  });
};

const constructPullRequestClosedMessage = (
  event: PullRequestClosedEvent,
): VBMLMessage => {
  return VestaboardClient.createEventMessage({
    eventType: "pull_request",
    timestamp: new Date(event.pull_request.closed_at!),
    repoName: event.repository.name,
    userLogin: event.sender.login,
    mainContent: event.pull_request.title,
  });
};

const constructStarCreatedMessage = (event: StarCreatedEvent): VBMLMessage => {
  return VestaboardClient.createEventMessage({
    eventType: "star",
    timestamp: new Date(event.starred_at!),
    repoName: event.repository.name,
    userLogin: event.sender.login,
    mainContent: "",
  });
};
