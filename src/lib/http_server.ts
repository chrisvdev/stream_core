import express from "express";
import morgan from "morgan";
import stateChecker from "@lib/state_checker.js";
import { TWITCH_CLIENT_ID } from "./enviroment.js";
import { UserTokenParams } from "./types.js";
import twitchOAuth2 from "./twitch/oauth.js";
import Logger from "./log/logger.js";
import { TokenLevel } from "./twitch/types.js";

const { log, warn, error } = new Logger("HTTP Server");

const httpServer = express();

httpServer.use(morgan("dev"));

const scopes = ["user:bot"];

const oAuthAuthorizeURL = new URL("https://id.twitch.tv/oauth2/authorize");
oAuthAuthorizeURL.searchParams.set("response_type", "code");
oAuthAuthorizeURL.searchParams.set("client_id", TWITCH_CLIENT_ID);
oAuthAuthorizeURL.searchParams.set(
  "redirect_uri",
  "http://localhost:3000/twitch/user_token"
);
oAuthAuthorizeURL.searchParams.set("scope", scopes.join(" "));
oAuthAuthorizeURL.searchParams.set("state", stateChecker.currentState);

httpServer.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  res.end(/*html*/ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CVD Stream Core</title>
  </head>
  <body>
    ${
      twitchOAuth2.tokenLevel === TokenLevel.USER
        ? `<p>Authenticated with Twitch</p>`
        : `<a
      href="${oAuthAuthorizeURL.toString()}"
      >Connect to Twitch</a
    >`
    }
  </body>
</html>
`);
});
httpServer.get("/twitch/user_token", (req, res) => {
  const { code, scope, state } = req.query as UserTokenParams;
  const scopes = scope.split(" ");
  const correctState = stateChecker.validate(state);
  if (correctState) twitchOAuth2.setUserToken(code);
  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  res.end(/*html*/ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CVD Stream Core</title>
  </head>
  <body>
    ${
      correctState
        ? `<h1>Success</h1>
      <h2>Granted scopes: </h2>
      <ul>
      ${scopes.map((scope) => `<li>${scope}</li>`).join("")}
      </ul>
      `
        : "<h1>Error</h1>"
    }
    <a href="http://localhost:3000">Back</a>
  </body>
</html>
`);
});

export default httpServer;
