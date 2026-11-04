import "react-router";

declare module "react-router" {
  interface AppLoadContext {
    socketAddress: string;
    /** Per-request CSP nonce generated in server.js. */
    nonce: string;
  }
}
