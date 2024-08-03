import WebSocket from "ws";
import {
  EventSubBasicMessage,
  EventSubKeepAliveCB,
  EventSubNotificationCB,
  EventSubNotificationMessage,
  EventSubReconnectCB,
  EventSubReconnectMessage,
  EventSubRevocationCB,
  EventSubRevocationMessage,
  EventSubWelcomeCB,
  EventSubWelcomeMessage,
} from "./types.js";
import Logger from "@lib/log/logger.js";
const moduleLogger = new Logger("Twitch->EventSub");
const { log, warn, error } = moduleLogger;

export default class EventSub {
  private _wsURL: string = "wss://eventsub.wss.twitch.tv/ws";
  private _socket: WebSocket | null = null;
  private _sessionID: string = "";
  private _keepAliveTimer: NodeJS.Timeout | null = null;
  private _keepAliveCount: number | null = 11;
  private toCallWhenWelcome: EventSubWelcomeCB[] = [];
  private toCallWhenKeepAlive: EventSubKeepAliveCB[] = [];
  private toCallWhenNotification: EventSubNotificationCB[] = [];
  private toCallWhenReconnect: EventSubReconnectCB[] = [];
  private toCallWhenRevocation: EventSubRevocationCB[] = [];
  constructor() {
    this.onWelcome((message) => {
      this._sessionID = message.payload.session.id;
      this._keepAliveCount =
        message.payload.session.keepalive_timeout_seconds + 1;
    });
    this.onReconnect((message) => {
      this._wsURL = message.payload.session.reconnect_url;
      this._keepAliveCount = message.payload.session.keepalive_timeout_seconds;
      this._keepAliveTimer && clearTimeout(this._keepAliveTimer);
      this.resetConnection();
    });
    this.onRevocation((message) => {
      log(
        `Revocation received on notifications for boradcaster ID ${message.payload.subscription.condition.broadcaster_user_id} on event ${message.payload.subscription.type}`
      );
    });
  }
  public init() {
    this._socket = new WebSocket(this._wsURL);
    this._socket.on("open", () => {
      log("Connected to EventSub");
    });
    this._socket.on("message", (data) => {
      this.messageDigester(this.bufferToData(data as Buffer));
    });
    this._socket.on("close", () => {
      log("Disconnected from EventSub, reconnecting in 5 seconds...");
      this._keepAliveTimer && clearTimeout(this._keepAliveTimer);
      this._keepAliveTimer && clearTimeout(this._keepAliveTimer);
      this._keepAliveCount = 11;
      this._keepAliveTimer = setTimeout(() => {
        this.resetConnection();
      }, 5000);
    });
  }
  private bufferToData(buffer: Buffer) {
    const message = JSON.parse(buffer.toString()) as EventSubBasicMessage;
    return {
      ...message,
      metadata: {
        ...message.metadata,
        message_timestamp: new Date(message.metadata.message_timestamp),
      },
    } satisfies EventSubBasicMessage;
  }
  public onWelcome(cb: EventSubWelcomeCB) {
    this.toCallWhenWelcome.push(cb);
  }
  public onKeepAlive(cb: EventSubKeepAliveCB) {
    this.toCallWhenKeepAlive.push(cb);
  }
  public onNotification(cb: EventSubNotificationCB) {
    this.toCallWhenNotification.push(cb);
  }
  public onReconnect(cb: EventSubReconnectCB) {
    this.toCallWhenReconnect.push(cb);
  }
  public onRevocation(cb: EventSubRevocationCB) {
    this.toCallWhenRevocation.push(cb);
  }
  private resetConnection() {
    this._socket?.close();
    this.init();
  }
  private messageDigester(message: EventSubBasicMessage) {
    this._keepAliveTimer && clearTimeout(this._keepAliveTimer);
    if (this._keepAliveCount)
      this._keepAliveTimer = setTimeout(() => {
        this.resetConnection();
      }, this._keepAliveCount * 1000);
    log(message);
    switch (message.metadata.message_type) {
      case "session_welcome": {
        const { metadata, payload } = message as EventSubWelcomeMessage;
        this.toCallWhenWelcome.forEach((cb) => {
          cb({
            metadata,
            payload: {
              ...payload,
              session: {
                ...payload.session,
                connected_at: new Date(payload.session.connected_at),
              },
            },
          } satisfies EventSubWelcomeMessage);
        });
        break;
      }
      case "session_keepalive": {
        this.toCallWhenKeepAlive.forEach((cb) =>
          cb(message as EventSubBasicMessage)
        );
        break;
      }
      case "notification": {
        const { metadata, payload } = message as EventSubNotificationMessage;
        this.toCallWhenNotification.forEach((cb) =>
          cb({
            metadata,
            payload: {
              ...payload,
              subscription: {
                ...payload.subscription,
                created_at: new Date(payload.subscription.created_at),
              },
            },
          } satisfies EventSubNotificationMessage)
        );
        break;
      }
      case "session_reconnect": {
        const { metadata, payload } = message as EventSubReconnectMessage;
        this.toCallWhenReconnect.forEach((cb) =>
          cb({
            metadata,
            payload: {
              ...payload,
              session: {
                ...payload.session,
                connected_at: new Date(payload.session.connected_at),
              },
            },
          } satisfies EventSubReconnectMessage)
        );
        break;
      }
      case "revocation": {
        const { metadata, payload } = message as EventSubRevocationMessage;
        this.toCallWhenRevocation.forEach((cb) =>
          cb({
            metadata,
            payload: {
              ...payload,
              subscription: {
                ...payload.subscription,
                created_at: new Date(payload.subscription.created_at),
              },
            },
          } satisfies EventSubRevocationMessage)
        );
        break;
      }
    }
  }
}
