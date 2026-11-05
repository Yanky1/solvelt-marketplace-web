import "react-router";

declare module "react-router" {
  interface AppLoadContext {
    socketAddress: string;
    /** Per-request CSP nonce generated in server.js. */
    nonce: string;
    /** Per-request holder of the reference shown on the error page (app/lib/error-ref.server.ts); made in server.js. Optional so tests can build a context without it. */
    errorRef?: { id?: string };
  }
}
