import {
  Action,
  ActionPanel,
  Clipboard,
  Color,
  Detail,
  getPreferenceValues,
  Icon,
  List,
  open,
  showToast,
  Toast,
  Keyboard,
} from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useEffect, useState } from "react";
import {
  AuthError,
  clearCache,
  DeviceCode,
  getPull,
  listRecentPulls,
  pollForToken,
  PullRequest,
  requestDeviceCode,
} from "./github";

export default function Command() {
  const { value: token, setValue, removeValue, isLoading } = useLocalStorage<string>("github-token");

  if (isLoading) return <List isLoading />;
  if (!token) return <Connect onToken={setValue} />;

  const disconnect = async () => {
    clearCache();
    await removeValue();
  };
  return <Search token={token} onDisconnect={disconnect} />;
}

// "#123", "123" or "owner/repo#123"
function parseNumberQuery(text: string, defaultRepo: string) {
  const m = text.trim().match(/^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/);
  return m ? { repo: m[1] ?? defaultRepo, digits: m[2] } : undefined;
}

function Search({ token, onDisconnect }: { token: string; onDisconnect: () => Promise<void> }) {
  const { repo } = getPreferenceValues<Preferences>();
  const [text, setText] = useState("");
  const query = parseNumberQuery(text, repo);
  const number = query ? Number(query.digits) : 0;

  const onError = (error: Error) => {
    if (error instanceof AuthError) onDisconnect();
  };

  // One list request per open; cached data renders instantly, ETag makes revalidation free when nothing changed.
  const recent = useCachedPromise(listRecentPulls, [token, repo], { keepPreviousData: true, onError });

  const local =
    query?.repo === repo ? (recent.data ?? []).filter((p) => String(p.number).startsWith(query.digits)) : [];
  const exactLocal = local.find((p) => p.number === number);

  // Only hit the API for a number we don't already have.
  const single = useCachedPromise(getPull, [token, query?.repo ?? repo, number], {
    execute: !!query && !exactLocal && !recent.isLoading,
    onError,
  });

  const exactRemote = query && !exactLocal && single.data?.number === number ? single.data : undefined;
  const items = query
    ? [...(exactLocal ? [exactLocal] : exactRemote ? [exactRemote] : []), ...local.filter((p) => p !== exactLocal)]
    : (recent.data ?? []);

  const refresh = () => {
    recent.revalidate();
    if (query) single.revalidate();
  };

  return (
    <List
      isLoading={recent.isLoading || (!!query && !exactLocal && single.isLoading)}
      filtering={!query}
      throttle
      onSearchTextChange={setText}
      searchBarPlaceholder={`#NUMBER in ${repo}, or search titles…`}
    >
      {items.map((pr) => (
        <PullItem key={`${pr.repo}#${pr.number}`} pr={pr} onRefresh={refresh} onDisconnect={onDisconnect} />
      ))}
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={query && !single.isLoading ? `No PR #${query.digits} in ${query.repo}` : "Type #NUMBER"}
      />
    </List>
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
  onRefresh,
  onDisconnect,
}: {
  pr: PullRequest;
  onRefresh: () => void;
  onDisconnect: () => Promise<void>;
}) {
  return (
    <List.Item
      icon={{ source: STATE[pr.state].icon, tintColor: STATE[pr.state].tint, tooltip: pr.state }}
      title={`#${pr.number}`}
      subtitle={pr.title}
      keywords={[pr.title, pr.author, String(pr.number)]}
      accessories={[{ text: pr.author }, { date: new Date(pr.updatedAt) }]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={pr.url} />
          <Action.CopyToClipboard title="Copy URL" content={pr.url} />
          <Action.CopyToClipboard
            title="Copy Markdown Link"
            content={`[#${pr.number} ${pr.title}](${pr.url})`}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={onRefresh}
          />
          <Action
            title="Disconnect GitHub"
            icon={Icon.Logout}
            style={Action.Style.Destructive}
            onAction={onDisconnect}
          />
        </ActionPanel>
      }
    />
  );
}

function Connect({ onToken }: { onToken: (token: string) => Promise<void> }) {
  const { clientId } = getPreferenceValues<Preferences>();
  const [code, setCode] = useState<DeviceCode>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await requestDeviceCode(clientId);
        if (cancelled) return;
        setCode(c);
        await Clipboard.copy(c.user_code);
        await open(c.verification_uri);
        const token = await pollForToken(clientId, c, () => cancelled);
        await onToken(token);
        await showToast({ style: Toast.Style.Success, title: "Connected to GitHub" });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markdown = error
    ? `# Couldn't connect\n\n${error}`
    : code
      ? `# Connect GitHub\n\nPaste this code in the browser tab that just opened (it's already on your clipboard):\n\n# \`${code.user_code}\`\n\nWaiting for approval…`
      : "# Connecting to GitHub…";

  return (
    <Detail
      isLoading={!error}
      markdown={markdown}
      actions={
        code && (
          <ActionPanel>
            <Action.OpenInBrowser title="Open GitHub" url={code.verification_uri} />
            <Action.CopyToClipboard title="Copy Code" content={code.user_code} />
          </ActionPanel>
        )
      }
    />
  );
}
