import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  getPreferenceValues,
  List,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { useLocalStorage } from "@raycast/utils";
import { useEffect, useState } from "react";
import { DeviceCode, pollForToken, requestDeviceCode } from "./github";

export type Session = { token: string; disconnect: () => Promise<void>; initialText: string };

// Wraps a command: shows the device login until a token exists.
export function withGitHub(Command: (props: Session) => React.JSX.Element) {
  // Text typed in Raycast root search ("Use 2322 with…") or the command argument.
  return function Authenticated(props: { arguments?: { query?: string }; fallbackText?: string }) {
    const { value: token, setValue, removeValue, isLoading } = useLocalStorage<string>("github-token");
    if (isLoading) return <List isLoading />;
    if (!token) return <Connect onToken={setValue} />;
    return (
      <Command
        token={token}
        disconnect={removeValue}
        initialText={props.arguments?.query || props.fallbackText || ""}
      />
    );
  };
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
      ? `# Connect GitHub\n\nPaste this code in the browser tab that just opened (it's already on your clipboard):\n\n# \`${code.user_code}\`\n\nGrant access to your organizations on that page so their repos are searchable.\n\nWaiting for approval…`
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
