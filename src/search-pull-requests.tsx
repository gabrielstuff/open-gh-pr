import { Action, ActionPanel, Color, Icon, List, Keyboard } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState } from "react";
import { Session, withGitHub } from "./auth";
import { AuthError, findPullInRepos, listMyRecentPulls, PullRequest } from "./github";
import { RepoPicker, useSearchedRepos } from "./repos";

// "#123", "123", "repo#123" or "owner/repo#123"
function parseNumberQuery(text: string) {
  // A repo prefix only counts when followed by "#", so "332" stays PR 332, not repo "33" + PR 2.
  const m = text.trim().match(/^(?:([\w.-]+(?:\/[\w.-]+)?)#|#)?(\d+)$/);
  return m ? { repo: m[1]?.toLowerCase(), digits: m[2], number: Number(m[2]) } : undefined;
}

function Search({ token, disconnect, initialText }: Session) {
  const [text, setText] = useState(initialText);
  const query = parseNumberQuery(text);
  const onError = (error: Error) => {
    if (error instanceof AuthError) disconnect();
  };

  // One request per open: PRs you're involved in, across every repo. Cached, so it renders instantly.
  const recent = useCachedPromise(listMyRecentPulls, [token], { keepPreviousData: true, onError });
  const { searched, repos } = useSearchedRepos(token);

  const matchesRepo = (repo: string) => {
    if (!query?.repo) return true;
    const r = repo.toLowerCase();
    return query.repo.includes("/") ? r === query.repo : r.endsWith(`/${query.repo}`);
  };
  const targetRepos = query?.repo ? (repos.data ?? searched).filter(matchesRepo) : searched;

  // One request per typed number, for all target repos at once (GraphQL aliases).
  const remote = useCachedPromise(findPullInRepos, [token, targetRepos, query?.number ?? 0], {
    execute: !!query && targetRepos.length > 0,
    keepPreviousData: false,
    onError,
  });

  const key = (p: PullRequest) => `${p.repo}#${p.number}`;
  let items = recent.data ?? [];
  if (query) {
    const local = items.filter((p) => matchesRepo(p.repo) && String(p.number).startsWith(query.digits));
    const exact = [...(remote.data ?? []), ...local.filter((p) => p.number === query.number)];
    const seen = new Set<string>();
    items = [...exact, ...local].filter((p) => !seen.has(key(p)) && seen.add(key(p)));
  }

  const actions = { onRefresh: () => (recent.revalidate(), remote.revalidate()), disconnect, token };

  return (
    <List
      isLoading={recent.isLoading || (!!query && remote.isLoading)}
      filtering={!query}
      throttle
      searchText={text}
      onSearchTextChange={setText}
      searchBarPlaceholder="#NUMBER, repo#NUMBER, or search your PRs…"
    >
      <List.Section title={query ? `#${query.digits}` : "Your Recent Pull Requests"}>
        {items.map((pr) => (
          <PullItem key={key(pr)} pr={pr} {...actions} />
        ))}
      </List.Section>
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={query && !remote.isLoading ? `No PR #${query.digits}` : "Type #NUMBER"}
        description={`Searching ${targetRepos.length} repos. Star repos with ⌘⇧S.`}
        actions={
          <ActionPanel>
            <ManageReposAction token={token} />
          </ActionPanel>
        }
      />
    </List>
  );
}

function ManageReposAction({ token }: { token: string }) {
  return (
    <Action.Push
      title="Choose Searched Repositories"
      icon={Icon.Star}
      shortcut={Keyboard.Shortcut.Common.Duplicate}
      target={<RepoPicker token={token} />}
    />
  );
}

const STATE = {
  open: { icon: Icon.CircleFilled, tint: Color.Green },
  draft: { icon: Icon.CircleDisabled, tint: Color.SecondaryText },
  merged: { icon: Icon.CheckCircle, tint: Color.Purple },
  closed: { icon: Icon.XMarkCircle, tint: Color.Red },
};

function PullItem({
  pr,
  token,
  onRefresh,
  disconnect,
}: {
  pr: PullRequest;
  token: string;
  onRefresh: () => void;
  disconnect: () => Promise<void>;
}) {
  return (
    <List.Item
      icon={{ source: STATE[pr.state].icon, tintColor: STATE[pr.state].tint, tooltip: pr.state }}
      title={`#${pr.number}`}
      subtitle={pr.title}
      keywords={[pr.title, pr.author, pr.repo, String(pr.number)]}
      accessories={[{ tag: pr.repo.split("/")[1] }, { text: pr.author }, { date: new Date(pr.updatedAt) }]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={pr.url} />
          <Action.CopyToClipboard title="Copy URL" content={pr.url} />
          <Action.CopyToClipboard
            title="Copy Markdown Link"
            content={`[${pr.repo}#${pr.number} ${pr.title}](${pr.url})`}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <ManageReposAction token={token} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={onRefresh}
          />
          <Action title="Disconnect GitHub" icon={Icon.Logout} style={Action.Style.Destructive} onAction={disconnect} />
        </ActionPanel>
      }
    />
  );
}

export default withGitHub(Search);
