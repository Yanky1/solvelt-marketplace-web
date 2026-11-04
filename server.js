// Production Node server: serves the React Router SSR build.
import { createRequestHandler } from "@react-router/express";
import express from "express";

// Importing the build runs start-up config validation (fails fast in production).
const build = await import("./build/server/index.js");

const app = express();
app.disable("x-powered-by");
// No Express "trust proxy": the client IP is resolved by app/lib/client-ip.server.ts from TRUSTED_PROXIES.
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client", { maxAge: "1h" }));
app.use(createRequestHandler({ build, getLoadContext: (req) => ({ socketAddress: req.socket.remoteAddress ?? "" }) }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`solvelt-web listening on :${port}`));
