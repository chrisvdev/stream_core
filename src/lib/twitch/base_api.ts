import twitchOAuth2 from "./oauth.js";
import axios, { AxiosInstance } from "axios";
import Logger from "../log/logger.js";
const { log, warn, error } = new Logger("Twitch->BaseAPI");

export default class Twitch {
  private twitchBaseAPI: AxiosInstance | null = null;

  constructor() {
    twitchOAuth2.onTokenReady((twitchOAuth2) => {
      log(`Authenticated with Twitch as ${twitchOAuth2.tokenLevel}`);
      this.twitchBaseAPI = axios.create({
        baseURL: "https://api.twitch.tv/helix",
        headers: {
          "Client-Id": process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${twitchOAuth2.accessToken}`,
        },
      });
    });
  }
  get baseAPI() {
    return this.twitchBaseAPI;
  }
}
