"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon, WifiIcon } from "lucide-react";

import { Chip, SignalBars, rssiToBars } from "@/components/console/instrument";
import { PasswordInput } from "@/components/settings/password-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWifiConnect } from "@/hooks/use-wifi-connect";
import { useWifiScan } from "@/hooks/use-wifi-scan";
import type { WifiNetwork } from "@/lib/api/network";
import { cn } from "@/lib/utils";

/**
 * Add network: pick a network the robot can see, give it a password, join.
 * A success goes back to the Wi-Fi page, where the robot now has it saved; a
 * dropped connection stays here, since it probably means the join worked and
 * the notice on how to find the robot again is what matters.
 *
 * Takes no props and always renders: scanning and joining don't depend on the
 * state poll, and a console that has never heard from the robot is the one
 * that most needs to fix its Wi-Fi.
 *
 * No addressing form: the backend only scans and connects, and a form that
 * saved nothing was worse than none. No free-text SSID either (the scan skips
 * hidden ones): hand-typed SSIDs were the bug the picker replaced.
 */
export function NetworkSettings() {
  const router = useRouter();
  const scan = useWifiScan();
  const wifi = useWifiConnect();

  const [picked, setPicked] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");

  const current = wifi.current;
  const currentSsid = current?.ssid || null;
  // The dropdown defaults to the connected network with no effect to sync it:
  // `picked` is only what the operator changed it to.
  const ssid = picked ?? currentSsid;

  // The scan may not list the network the robot is on (a rescan mid-roam, a
  // weak AP), and the controlled Select shows nothing for a value with no
  // item — so the connected network is synthesised from the state poll when
  // missing, and always sorts first.
  const options = React.useMemo<WifiNetwork[]>(() => {
    const scanned = scan.networks ?? [];
    const list =
      currentSsid && current && !scanned.some((n) => n.ssid === currentSsid)
        ? [{ ssid: current.ssid, bssid: current.bssid, rssi: current.rssi }, ...scanned]
        : [...scanned];
    return list.sort((a, b) => {
      if (a.ssid === currentSsid) return -1;
      if (b.ssid === currentSsid) return 1;
      return b.rssi - a.rssi;
    });
  }, [scan.networks, current, currentSsid]);

  const isCurrent = ssid !== null && ssid === currentSsid;
  const canConnect = ssid !== null && !wifi.busy && !isCurrent;

  const submit = async () => {
    if (!canConnect || ssid === null) return;
    const outcome = await wifi.connect(ssid, password);
    // Don't keep a used secret in state; keep it only on a refusal so a typo
    // can be fixed without retyping.
    if (outcome !== "error") setPassword("");
    if (outcome === "ok") router.push("/settings/wifi");
  };

  const placeholder = scan.scanning
    ? "Scanning…"
    : options.length
      ? "Pick a network"
      : "No networks found";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiIcon className="size-4 text-muted-foreground" />
          Network
        </CardTitle>
        <CardDescription>
          Choose a WiFi network the robot can see. The password is optional for
          an open network. The robot saves the network once it joins.
        </CardDescription>
      </CardHeader>
      <form
        // A form so Enter in the password field connects.
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="wifi-ssid">Network</Label>
            <div className="flex items-center gap-2">
              <Select
                // `items` makes SelectValue render the label row, not the raw SSID.
                items={options.map((network) => ({
                  value: network.ssid,
                  label: (
                    <WifiOptionLabel
                      network={network}
                      connected={network.ssid === currentSsid}
                    />
                  ),
                }))}
                value={ssid}
                disabled={wifi.busy || (scan.scanning && options.length === 0)}
                onValueChange={(next) => setPicked(next as string)}
              >
                <SelectTrigger id="wifi-ssid" className="w-full min-w-0 flex-1">
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((network) => (
                    <SelectItem key={network.ssid} value={network.ssid}>
                      <WifiOptionLabel
                        network={network}
                        connected={network.ssid === currentSsid}
                      />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={scan.scanning || wifi.busy}
                onClick={scan.rescan}
              >
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={cn(scan.scanning && "animate-spin")}
                />
                Rescan
              </Button>
            </div>
            {scan.scanning ? (
              <Hint>Scanning for networks — this takes up to 45 seconds.</Hint>
            ) : scan.status === "error" && scan.error ? (
              // A failed rescan keeps the previous list, so this is a note.
              <Hint className="text-signal-warn">{scan.error}</Hint>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="wifi-password">Password</Label>
            <PasswordInput
              id="wifi-password"
              value={password}
              disabled={wifi.busy}
              placeholder="Leave empty for an open network"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {/* In place rather than a toast: the operator is watching this card. */}
          {wifi.pending && (
            <Hint className="text-signal-caution">
              Connecting to <span className="readout">{wifi.pending}</span>… the
              robot reports its network once a second.
            </Hint>
          )}
          {wifi.message && (
            <Hint className="text-signal-live">{wifi.message}</Hint>
          )}
          {wifi.error && (
            <Hint role="alert" className="text-signal-warn">
              {wifi.error}
            </Hint>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={!canConnect}>
            <WifiIcon data-icon="inline-start" />
            {wifi.busy ? "Connecting…" : isCurrent ? "Connected" : "Connect"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/**
 * One network as a row: bars, name, dBm, and a Connected chip. Used for both
 * the trigger and the list items so the two cannot drift.
 */
function WifiOptionLabel({
  network,
  connected,
}: {
  network: WifiNetwork;
  connected: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SignalBars
        bars={rssiToBars(network.rssi)}
        tone={connected ? "live" : "neutral"}
      />
      <span className="truncate">{network.ssid}</span>
      <span className="readout text-[11px] text-muted-foreground">
        {network.rssi} dBm
      </span>
      {connected && <Chip tone="live">Connected</Chip>}
    </span>
  );
}

function Hint({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[11px] leading-snug text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  );
}
