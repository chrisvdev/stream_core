import { HTTP_PORT } from "./lib/environment.js";
import Logger from "./lib/log/logger.js";
import httpServer from "./lib/http_server.js";
import twitchOAuth2 from "./lib/twitch/oauth.js";
import {
  EventSubSubscriptionRequest,
  TokenLevel,
  TwitchError,
} from "./lib/twitch/types.js";
import EventSub from "./lib/twitch/eventsub_ws.js";
import Twitch from "./lib/twitch/base_api.js";
import { AxiosError } from "axios";

const logger = new Logger("StreamCore");
const { log, warn, error } = logger;
const twitch = new Twitch();
const eventSub = new EventSub();
eventSub.onWelcome((message) => {
  const { id } = message.payload.session;
  const request: EventSubSubscriptionRequest = {
    type: "channel.chat.message",
    version: "1",
    condition: {
      broadcaster_user_id: "418319555",
      user_id: "1032725593",
    },
    transport: {
      method: "websocket",
      session_id: id,
    },
  };
  twitch.baseAPI
    ?.post("/eventsub/subscriptions", request, {
      headers: { "Content-Type": "application/json" },
    })
    .then((response) => {
      log("Subscription created", response.data);
    })
    .catch((err) => {
      const e = err as AxiosError<TwitchError>;
      error(
        "Failed to create subscription",
        e.message,
        e.response?.data.message
      );
    });
});
eventSub.onNotification((message) => {
  log("Notification received", JSON.stringify(message, null, 2));
});

log("Starting...");

httpServer.listen(HTTP_PORT, () => {
  log(`HTTP Server running on port ${HTTP_PORT}`);
});

twitchOAuth2.onTokenReady((twitchOAuth2) => {
  switch (twitchOAuth2.tokenLevel) {
    case TokenLevel.APPLICATION:
      log("Authenticated with Twitch as application");
      break;

    case TokenLevel.USER:
      log("Authenticated with Twitch as user, starting EventSub...");
      eventSub.init();
      break;

    default:
      break;
  }
});
