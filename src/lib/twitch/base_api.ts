import twitchOAuth2 from "./oauth.js";
import axios, { AxiosInstance } from "axios";

export default class Twitch {
  private twitchBaseAPI: AxiosInstance | null = null;

  constructor() {
    twitchOAuth2.onTokenReady((twitchOAuth2) => {
      this.twitchBaseAPI = axios.create({
        baseURL: "https://api.twitch.tv/helix",
        headers: {
          //"Client-Id": process.env.TWITCH_CLIENT_ID,
          "Client-Id": "gp762nuuoqcoxypju8c569th9wz7q5",
          // Authorization: `Bearer ${twitchOAuth2.accessToken}`,
          Authorization: `Bearer 7s0e7ed57wr3qbm4xsk9ivm3s82cbp`,
        },
      });
    });
  }
  get baseAPI() {
    return this.twitchBaseAPI;
  }
}
