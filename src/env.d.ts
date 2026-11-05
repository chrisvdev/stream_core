declare namespace App {
  interface Locals {
    core: import("./core").AppContext;
    /** Also sent as the `x-request-id` response header to correlate browser and server logs. */
    requestId: string;
  }
}
