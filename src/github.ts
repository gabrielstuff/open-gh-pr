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

type GqlPull = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  url: string;
  updatedAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
};

const PR_FIELDS = "number title state isDraft url updatedAt author { login } repository { nameWithOwner }";

function toPull(p: GqlPull): PullRequest {
  const state = p.state === "MERGED" ? "merged" : p.state === "CLOSED" ? "closed" : p.isDraft ? "draft" : "open";
  return {
    repo: p.repository.nameWithOwner,
    number: p.number,
    title: p.title,
    state,
    author: p.author?.login ?? "ghost",
    url: p.url,
    updatedAt: p.updatedAt,
  };
}

// Everything goes through GraphQL so each screen costs exactly one request.
async function graphql<T>(token: string, query: string): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (res.status === 401) throw new AuthError("GitHub token expired or revoked");
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  // Partial errors are expected: a repo without PR #N resolves to null.
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? "GitHub returned no data");
  return json.data;
}

export async function listMyRecentPulls(token: string) {
  const data = await graphql<{ search: { nodes: Partial<GqlPull>[] } }>(
    token,
    `query { search(query: "is:pr involves:@me sort:updated-desc", type: ISSUE, first: 100) {
      nodes { ... on PullRequest { ${PR_FIELDS} } } } }`,
  );
  return data.search.nodes.filter((n): n is GqlPull => !!n.number).map(toPull);
}

export async function listMyRepos(token: string) {
  const data = await graphql<{ viewer: { repositories: { nodes: { nameWithOwner: string; isArchived: boolean }[] } } }>(
    token,
    `
      query {
        viewer {
          repositories(
            first: 100
            orderBy: { field: PUSHED_AT, direction: DESC }
            ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
          ) {
            nodes {
              nameWithOwner
              isArchived
            }
          }
        }
      }
    `,
  );
  return data.viewer.repositories.nodes.filter((r) => !r.isArchived).map((r) => r.nameWithOwner);
}

// One request for PR #number across all given repos, using aliases.
export async function findPullInRepos(token: string, repos: string[], number: number) {
  if (!repos.length || !number) return [];
  const fields = repos.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${number}) { ${PR_FIELDS} } }`;
  });
  const data = await graphql<Record<string, { pullRequest: GqlPull | null } | null>>(
    token,
    `query { ${fields.join("\n")} }`,
  );
  return Object.values(data).flatMap((r) => (r?.pullRequest ? [toPull(r.pullRequest)] : []));
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
    scope: "repo read:org",
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
