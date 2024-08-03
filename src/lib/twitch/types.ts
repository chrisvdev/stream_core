import { TwitchOAuth2 } from "./oauth.js";

export type TwitchOAuth2Response = {
  access_token: string;
  expires_in: number;
  token_type: "bearer";
  refresh_token?: string;
};

export type TwitchOAuth2CallBack = (thisInstance: TwitchOAuth2) => void;

export type EventSubMetadata = {
  metadata: {
    message_id: string;
    message_type:
      | "session_welcome"
      | "session_keepalive"
      | "notification"
      | "session_reconnect"
      | "revocation";
    message_timestamp: Date;
  };
};

export type EventSubBasicMessage = EventSubMetadata & {
  payload: unknown;
};

export type EventSubWelcomePayload = {
  payload: {
    session: {
      id: string;
      status: string;
      connected_at: Date;
      keepalive_timeout_seconds: number;
      reconnect_url: null;
      recovery_url: null;
    };
  };
};

export type EventSubWelcomeMessage = EventSubBasicMessage &
  EventSubWelcomePayload;

export type EventSubWelcomeCB = (message: EventSubWelcomeMessage) => void;

export type EventSubKeepAliveCB = (message: EventSubBasicMessage) => void;

export type EventSubNotificationPayload = {
  payload: {
    subscription: EventSubSubscription;
    event: EventSubEvent;
  };
};

export type EventSubEvent = {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  followed_at: Date;
};

export type EventSubSubscription = {
  id: string;
  status: string;
  type: EventSubSubscriptionType;
  version: string;
  cost: number;
  condition: EventSubNotificationCondition;
  transport: EventSubNotificationTransport;
  created_at: Date;
};

export type EventSubNotificationCondition = {
  broadcaster_user_id: string;
};

export type EventSubNotificationTransport = {
  method: string;
  session_id: string;
};

export type EventSubNotificationMessage = EventSubMetadata &
  EventSubNotificationPayload & {
    metadata: {
      subscription_type: EventSubSubscriptionType;
      subscription_version: string;
    };
  };

export type EventSubSubscriptionType = "channel.follow";

export type EventSubNotificationCB = (
  message: EventSubNotificationMessage
) => void;

export type EventSubReconnectPayload = {
  payload: {
    session: {
      id: string;
      status: string;
      keepalive_timeout_seconds: null;
      reconnect_url: string;
      connected_at: Date;
    };
  };
};

export type EventSubReconnectMessage = EventSubBasicMessage &
  EventSubReconnectPayload;

export type EventSubReconnectCB = (message: EventSubReconnectMessage) => void;

export type EventSubRevocationMessage = EventSubMetadata &
  EventSubNotificationPayload & {
    metadata: {
      subscription_type: EventSubSubscriptionType;
      subscription_version: string;
    };
  };

export type EventSubRevocationCB = (message: EventSubRevocationMessage) => void;

export enum TokenLevel {
  USER,
  APPLICATION,
}

export interface EventSubSubscriptionRequest {
  type: string | "channel.chat.message";
  version: string | "1";
  condition: EventSubSubscriptionCondition;
  transport: EventSubSubscriptionTransport;
}

export interface EventSubSubscriptionCondition {
  broadcaster_user_id: "418319555"; //ChrisVDev
  user_id: "1032725593"; //Falcon_Verde
}

export interface EventSubSubscriptionTransport {
  method: "websocket";
  session_id: string;
}

export type TokenXWWWFormUrlEncodedData = {
  client_id: string;
  client_secret: string;
  grant_type: "client_credentials" | "authorization_code" | "refresh_token";
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
};

export type TwitchError = {
  error: string;
  status?: number;
  message: string;
};
