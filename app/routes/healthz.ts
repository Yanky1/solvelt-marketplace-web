// `commit` says which build is running (Azure: set GIT_COMMIT_SHA or SOURCE_VERSION in the app settings or the deployment; GitHub Actions sets GITHUB_SHA). It is public, short and holds nothing secret.
const commit = (process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || process.env.GITHUB_SHA || "").trim().slice(0, 40);

export function loader() {
  return Response.json({ status: "ok", ...(/^[0-9a-f]{7,40}$/i.test(commit) ? { commit } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
