"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { CircleAlertIcon, Loader2Icon, LogInIcon } from "lucide-react";

import { PasswordInput } from "@/components/settings/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMounted } from "@/hooks/use-mounted";
import { useLogin, useSession } from "@/hooks/use-session";
import { safeNextPath } from "@/lib/auth/next-path";

// three.js and the robot's model are fetched after the form is up: the
// picture is decoration, and signing in never waits for it.
const WalkingRobot = dynamic(
  () => import("@/components/auth/walking-robot").then((m) => m.WalkingRobot),
  { ssr: false },
);

type Field = "username" | "password";

const MISSING: Record<Field, string> = {
  username: "Enter your username.",
  password: "Enter your password.",
};

/**
 * The sign-in screen, drawn outside the console's shell: no rail, no strip,
 * no polls, since there is no token yet to ask the robot anything with.
 *
 * Sign in is never greyed: a greyed button does not say what it is waiting
 * for. Pressed with a field empty, it says which, and puts the cursor there.
 * A refusal empties the password and returns to it, the username kept.
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
  const [missing, setMissing] = React.useState<Field | null>(null);
  const [capsLock, setCapsLock] = React.useState(false);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!mounted || !session) return;
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeNextPath(next));
  }, [mounted, session, router]);

  // Back to the password after a refusal, once the render that re-enables
  // the field has landed: the catch above runs while it is still disabled.
  const refused = loginMutation.error;
  React.useEffect(() => {
    if (refused) passwordRef.current?.focus();
  }, [refused]);

  const pending = loginMutation.isPending;
  const refusal = loginMutation.error?.message;

  const readCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const empty: Field | null = username.trim() === "" ? "username" : password === "" ? "password" : null;
    if (empty) {
      setMissing(empty);
      (empty === "username" ? usernameRef : passwordRef).current?.focus();
      return;
    }
    loginMutation.reset();
    loginMutation.mutateAsync({ username: username.trim(), password }).catch(() => {
      // The refusal is on the mutation, which is where the form reads it.
      setPassword("");
    });
  };

  return (
    <main className="flex h-dvh flex-col overflow-y-auto bg-background lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(26rem,1fr)] lg:overflow-hidden">
      {/* The robot walking its route: a band over the form on a phone, half
        * the screen from lg. */}
      <div className="relative h-44 shrink-0 overflow-hidden border-b border-hairline sm:h-56 lg:h-auto lg:border-r lg:border-b-0">
        <WalkingRobot className="absolute inset-0" />
      </div>

      {/* The half in the page's own ground and the form a card over it, its
        * own surface and edge, so it reads as a layer of its own. */}
      <div className="flex flex-1 items-center justify-center bg-background px-4 py-8 lg:px-12">
        <div className="w-full max-w-sm rounded-lg border border-hairline bg-panel p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

          <form className="mt-8 space-y-5" noValidate onSubmit={submit}>
            {refusal ? (
              <div
                role="alert"
                className="flex gap-2.5 rounded-md border border-signal-warn/40 bg-signal-warn/10 px-3 py-2.5 text-sm text-signal-warn"
              >
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <p className="min-w-0 break-words">{refusal}</p>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="login-username">Username</Label>
              <Input
                ref={usernameRef}
                id="login-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                // The first field on the screen: a keyboard user types at once.
                autoFocus
                value={username}
                disabled={pending}
                aria-invalid={missing === "username" || undefined}
                aria-describedby={missing === "username" ? "login-username-missing" : undefined}
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (missing === "username") setMissing(null);
                }}
              />
              {missing === "username" ? (
                <p id="login-username-missing" className="text-xs text-signal-warn">
                  {MISSING.username}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="login-password">Password</Label>
              <PasswordInput
                ref={passwordRef}
                id="login-password"
                name="password"
                autoComplete="current-password"
                value={password}
                disabled={pending}
                aria-invalid={missing === "password" || undefined}
                aria-describedby={
                  [
                    missing === "password" ? "login-password-missing" : null,
                    capsLock ? "login-caps-lock" : null,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onKeyDown={readCapsLock}
                onKeyUp={readCapsLock}
                onBlur={() => setCapsLock(false)}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (missing === "password") setMissing(null);
                }}
              />
              {missing === "password" ? (
                <p id="login-password-missing" className="text-xs text-signal-warn">
                  {MISSING.password}
                </p>
              ) : null}
              {capsLock ? (
                <p id="login-caps-lock" className="text-xs text-signal-caution">
                  Caps Lock is on.
                </p>
              ) : null}
            </div>

            <Button type="submit" size="lg" className="mt-2 w-full" aria-busy={pending || undefined}>
              {pending ? (
                <Loader2Icon data-icon="inline-start" aria-hidden className="animate-spin" />
              ) : (
                <LogInIcon data-icon="inline-start" aria-hidden />
              )}
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
