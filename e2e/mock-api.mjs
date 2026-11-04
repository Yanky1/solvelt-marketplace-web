// Minimal mock of the marketplace API for E2E (extended in later slices).
import http from "node:http";
const port = Number(process.env.MOCK_API_PORT ?? 5080);
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok" }));
  res.statusCode = 404;
  res.end(JSON.stringify({ code: "not_found", message: "Not found" }));
}).listen(port, () => console.log(`mock api on :${port}`));
