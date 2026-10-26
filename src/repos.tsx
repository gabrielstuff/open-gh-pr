import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useCachedPromise, useCachedState } from "@raycast/utils";
import { listMyRepos } from "./github";

const FALLBACK_COUNT = 10;

// Repos that #NUMBER searches: the starred ones, else the most recently pushed.
export function useSearchedRepos(token: string) {
  const [starred, setStarred] = useCachedState<string[]>("starred-repos", []);
  const repos = useCachedPromise(listMyRepos, [token], { keepPreviousData: true });
  const searched = starred.length ? starred : (repos.data ?? []).slice(0, FALLBACK_COUNT);
  return { starred, setStarred, repos, searched };
}

export function RepoPicker({ token }: { token: string }) {
  const { starred, setStarred, repos } = useSearchedRepos(token);
  const all = repos.data ?? [];
  const rest = all.filter((r) => !starred.includes(r));

  const toggle = (repo: string) =>
    setStarred(starred.includes(repo) ? starred.filter((r) => r !== repo) : [...starred, repo]);

  const item = (repo: string) => {
    const isStarred = starred.includes(repo);
    return (
      <List.Item
        key={repo}
        icon={isStarred ? { source: Icon.Star, tintColor: Color.Yellow } : Icon.Box}
        title={repo}
        actions={
          <ActionPanel>
            <Action
              title={isStarred ? "Unstar" : "Star"}
              icon={isStarred ? Icon.StarDisabled : Icon.Star}
              onAction={() => toggle(repo)}
            />
            {starred.length > 0 && <Action title="Clear Stars" icon={Icon.Trash} onAction={() => setStarred([])} />}
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List isLoading={repos.isLoading} searchBarPlaceholder="Star the repos #NUMBER should search…">
      <List.Section
        title="Starred"
        subtitle={starred.length ? undefined : `none — searching your ${FALLBACK_COUNT} most recently pushed repos`}
      >
        {starred.map(item)}
      </List.Section>
      <List.Section title="Your Repositories">{rest.map(item)}</List.Section>
    </List>
  );
}
