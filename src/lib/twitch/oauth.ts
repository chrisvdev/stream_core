import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { createRequire } from "module";
import {
  TokenLevel,
  TwitchOAuth2CallBack,
  TwitchOAuth2Response,
} from "./types.js";
import Logger from "@lib/log/logger.js";
const moduleLogger = new Logger("Twitch->OAuth");
const { log, warn, error } = moduleLogger;
const require = createRequire(import.meta.url);
const qs = require("qs");
const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;

const data = qs.stringify({
  client_id: TWITCH_CLIENT_ID,
  client_secret: TWITCH_CLIENT_SECRET,
  grant_type: "client_credentials",
});

const scopes = ["user:bot", "user:read:chat", "moderator:manage:announcements"];

const config: AxiosRequestConfig = {
  method: "post",
  maxBodyLength: Infinity,
  url: "https://id.twitch.tv/oauth2/token",
  params: { scope: scopes.join(" ") },
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  data: data,
};

export class TwitchOAuth2 {
  private twitchAccessToken: string = "";
  private tokenExpiresIn: number = 0;
  private currentTokenLevel: TokenLevel = TokenLevel.APPLICATION;
  private timer: NodeJS.Timeout = 0 as unknown as NodeJS.Timeout;
  private ready: boolean = false;
  private toCallWhenReady: TwitchOAuth2CallBack[] = [];
  constructor() {
    // this.init();
  }

  private async updateAccessToken() {
    try {
      const response = await axios.request(config);
      const { access_token, expires_in } =
        response.data as TwitchOAuth2Response;
      this.twitchAccessToken = access_token;
      this.tokenExpiresIn = expires_in;
      this.ready = true;
      this.currentTokenLevel = TokenLevel.APPLICATION;
      for (const cb of this.toCallWhenReady) {
        cb(this);
      }
      this.timer = setInterval(() => {
        this.tokenExpiresIn--;
        if (this.tokenExpiresIn <= 0) {
          clearInterval(this.timer);
          this.timer = 0 as unknown as NodeJS.Timeout;
          this.ready = false;
          this.updateAccessToken();
        }
      }, 1000);
    } catch (error) {
      const { name, message, toJSON } = error as AxiosError;
      console.error(name, message, toJSON());
      throw error;
    }
  }

  public async init() {
    try {
      await this.updateAccessToken();
    } catch (err) {
      const { name, message, toJSON } = err as AxiosError;
      console.error(name, message, toJSON());
      error("Error on init, trying again in 5 seconds");
      this.timer = setTimeout(() => {
        clearInterval(this.timer);
        this.init.bind(this)();
      }, 5000);
    }
  }

  public onTokenReady(cb: TwitchOAuth2CallBack) {
    if (this.ready) {
      cb(this);
    } else {
      this.toCallWhenReady.push(cb);
    }
  }

  public setUserToken(userToken: string) {
    this.ready = true;
    this.tokenExpiresIn = 0;
    clearInterval(this.timer);
    this.timer = 0 as unknown as NodeJS.Timeout;
    this.twitchAccessToken = userToken;
    this.currentTokenLevel = TokenLevel.USER;
    for (const cb of this.toCallWhenReady) {
      cb(this);
    }
  }
  get accessToken() {
    return this.ready ? this.twitchAccessToken : null;
  }
  get tokenLevel() {
    return this.currentTokenLevel;
  }
}

const twitchOAuth2 = new TwitchOAuth2();
export default twitchOAuth2;
