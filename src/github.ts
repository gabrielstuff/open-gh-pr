import { Cache } from "@raycast/api";

const API = "https://api.github.com";
const cache = new Cache();

export type PullRequest = {
  repo: string;
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  author: string;
  url: string;
  updatedAt: string;
};

export class AuthError extends Error {}

type RawPull = {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at: string | null;
  user: { login: string } | null;
  html_url: string;
  updated_at: string;
};

function toPull(repo: string, p: RawPull): PullRequest {
  const state = p.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open";
  return {
    repo,
    number: p.number,
    title: p.title,
    state,
    author: p.user?.login ?? "ghost",
    url: p.html_url,
    updatedAt: p.updated_at,
  };
}

// Conditional requests: a 304 costs nothing against the rate limit and skips the body.
async function get<T>(path: string, token: string, map: (json: never) => T): Promise<T> {
  const hit = cache.get(path);
  const cached = hit ? (JSON.parse(hit) as { etag: string; data: T }) : undefined;

  const res = await fetch(API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(cached && { "If-None-Match": cached.etag }),
    },
  });

  if (res.status === 304 && cached) return cached.data;
  if (res.status === 401) throw new AuthError("GitHub token expired or revoked");
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);

  const data = map((await res.json()) as never);
  const etag = res.headers.get("etag");
  if (etag) cache.set(path, JSON.stringify({ etag, data }));
  return data;
}

export function listRecentPulls(token: string, repo: string) {
  return get(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`, token, (json: RawPull[]) =>
    json.map((p) => toPull(repo, p)),
  );
}

export function getPull(token: string, repo: string, number: number) {
  return get(`/repos/${repo}/pulls/${number}`, token, (json: RawPull) => toPull(repo, json));
}

export function clearCache() {
  cache.clear();
}

// --- Device flow: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
};

async function post<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function requestDeviceCode(clientId: string) {
  const code = await post<DeviceCode & { error_description?: string }>("https://github.com/login/device/code", {
    client_id: clientId,
    scope: "repo",
  });
  if (!code.user_code) throw new Error(code.error_description ?? "Device flow is not enabled for this OAuth App");
  return code;
}

export async function pollForToken(clientId: string, code: DeviceCode, isCancelled: () => boolean) {
  let interval = code.interval;
  while (!isCancelled()) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await post<{ access_token?: string; error?: string; error_description?: string; interval?: number }>(
      "https://github.com/login/oauth/access_token",
      {
        client_id: clientId,
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    );
    if (res.access_token) return res.access_token;
    if (res.error === "slow_down") interval = res.interval ?? interval + 5;
    else if (res.error !== "authorization_pending") throw new Error(res.error_description ?? res.error);
  }
  throw new Error("Cancelled");
}
