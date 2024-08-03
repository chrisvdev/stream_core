/*
Este modulo implementa la aplicación OAuth2 de Twitch y sus ciclos de vida dependiendo 
del tipo de token que se quiera utilizar asegurando que se mantenga la validez del mismo
*/

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { createRequire } from "module";
import {
  TokenLevel,
  TokenXWWWFormUrlEncodedData,
  TwitchError,
  TwitchOAuth2CallBack,
  TwitchOAuth2Response,
} from "./types.js";
import Logger from "@lib/log/logger.js";
import { BASE_URL, REDIRECT_PATH, SCOPES } from "../environment.js";
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

export class TwitchOAuth2 {
  private scopes = SCOPES;
  private twitchAccessToken: string = "";
  private tokenExpiresIn: number = 0;
  private userCode: string | null = null;
  private refreshToken: string | null = null;
  private currentTokenLevel: TokenLevel = TokenLevel.APPLICATION;
  private timer: NodeJS.Timeout = 0 as unknown as NodeJS.Timeout;
  private ready: boolean = false;
  private toCallWhenReady: TwitchOAuth2CallBack[] = [];
  constructor() {
    this.init();
  }

  private getXWWWFormUrlEncodedData() {
    let data: TokenXWWWFormUrlEncodedData = {
      client_id: TWITCH_CLIENT_ID as string,
      client_secret: TWITCH_CLIENT_SECRET as string,
      grant_type: "client_credentials",
    };
    if (this.refreshToken) {
      data = {
        ...data,
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      };
    } else if (this.userCode) {
      data = {
        ...data,
        grant_type: "authorization_code",
        code: this.userCode,
        redirect_uri: BASE_URL + REDIRECT_PATH,
      };
    }

    return qs.stringify(data);
  }

  private async updateAccessToken() {
    try {
      const response = await axios.request({
        method: "post",
        maxBodyLength: Infinity,
        url: "https://id.twitch.tv/oauth2/token",
        params: { scope: this.scopes.join(" ") },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: this.getXWWWFormUrlEncodedData(),
      });
      log("Got new Twitch access token", response.data);
      const { access_token, expires_in } =
        response.data as TwitchOAuth2Response;
      this.twitchAccessToken = access_token;
      this.tokenExpiresIn = expires_in;
      this.ready = true;
      this.currentTokenLevel = this.userCode
        ? TokenLevel.USER
        : TokenLevel.APPLICATION;
      if (response.data.refresh_token)
        this.refreshToken = response.data.refresh_token;
      else this.refreshToken = null;
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
    } catch (err) {
      const { name, message, response } = err as AxiosError<TwitchError>;
      error(name, message, response?.data.message);
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

  public setUserToken(code: string) {
    this.ready = false;
    this.tokenExpiresIn = 0;
    clearInterval(this.timer);
    this.timer = 0 as unknown as NodeJS.Timeout;
    this.userCode = code;
    this.updateAccessToken();
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
