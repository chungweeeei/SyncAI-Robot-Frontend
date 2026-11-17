"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogInIcon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { PasswordInput } from "@/components/settings/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMounted } from "@/hooks/use-mounted";
import { useLogin, useSession } from "@/hooks/use-session";
import { safeNextPath } from "@/lib/auth/next-path";

/**
 * The sign-in screen, drawn outside the console's shell: no rail, no strip,
 * no polls, since there is no token yet to ask the robot anything with.
 *
 * A session appearing — this form's, or another tab's — is what leaves the
 * screen, for the page in `?next=`. Read from the location in the effect
 * rather than through useSearchParams, which would need a Suspense boundary
 * around a page whose only job is to render at once.
 */
export function LoginScreen() {
  const router = useRouter();
  const mounted = useMounted();
  const session = useSession();
  const loginMutation = useLogin();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (!mounted || !session) return;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeNextPath(next));
  }, [mounted, session, router]);

  const pending = loginMutation.isPending;
  const canSubmit = username.trim() !== "" && password !== "" && !pending;

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto bg-background px-4 py-8">
      <div className="w-full max-w-sm">
        <p className="instrument-label mb-2 text-muted-foreground">SyncAI Robot Console</p>
        <div className="rounded-md border border-hairline bg-panel p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to watch and drive the robot.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              loginMutation.reset();
              loginMutation.mutateAsync({ username: username.trim(), password }).catch(() => {
                // The refusal is on the mutation, which is where the form reads it.
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="login-username">Username</Label>
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                // The one field on the screen: a keyboard user should be able
                // to type at once.
                autoFocus
                value={username}
                disabled={pending}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="login-password">Password</Label>
              <PasswordInput
                id="login-password"
                name="password"
                autoComplete="current-password"
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <ErrorLine className="text-sm">{loginMutation.error?.message}</ErrorLine>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              <LogInIcon data-icon="inline-start" />
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
