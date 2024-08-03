/*
Esto es solo una implementación provisoria para probar que funcionen los módulos
*/

import { HTTP_PORT } from "./lib/environment.js";
import Logger from "./lib/log/logger.js";
import httpServer from "./lib/http_server.js"; // Servidor HTTP para la autenticación y posiblemente alguna cosa en el futuro
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
const twitch = new Twitch(); // Base para las llamadas a la API de Twitch
const eventSub = new EventSub(); // modulo que gestiona las la conexión WebSocket a EventSub de Twitch
eventSub.onWelcome((message) => {
  // Solo es un a prueba, esto se encarga de crear la suscripción una vez que se tiene el session_id de parte del servidor de websocket
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
  // cuando recibe una notificación de EventSub esto las va a mostrar
  log("Notification received", JSON.stringify(message, null, 2));
});

log("Starting...");

httpServer.listen(HTTP_PORT, () => {
  log(`HTTP Server running on port ${HTTP_PORT}`);
});

twitchOAuth2.onTokenReady((twitchOAuth2) => {
  // Cuando se tenga un token valido...
  switch (
    twitchOAuth2.tokenLevel // ... nos fijamos cual es el nivel de token y...
  ) {
    case TokenLevel.APPLICATION: // ... si es un token de aplicación por ahora no lo necesitamos
      log("Authenticated with Twitch as application");
      break;

    case TokenLevel.USER: // ... si es un token de usuario, iniciamos el modulo de EventSub
      log("Authenticated with Twitch as user, starting EventSub...");
      eventSub.init();
      break;

    default:
      break;

    /*
      A tener en cuenta: EventSub necesita de Tokens de usuario si usas WebSocket para suscribirte
      o de aplicación si usas WebHooks para suscribirte
      */
  }
});
