"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon, PlusIcon, Trash2Icon, WifiIcon } from "lucide-react";

import { Chip, SignalBars, rssiToBars } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWifiConnect, type WifiConnect } from "@/hooks/use-wifi-connect";
import {
  useForgetWifiConnection,
  useWifiConnections,
} from "@/hooks/use-wifi-connections";
import type { WifiConnection } from "@/lib/api/network";
import { lastUsedLabel, orderConnections } from "@/lib/network/connections";
import { cn } from "@/lib/utils";

/** Where Add network goes; the page's header and the empty state both link it. */
export const ADD_NETWORK_HREF = "/settings/wifi/new";

/**
 * The Wi-Fi page: the network the robot is on, then every network it has
 * saved as a card that rejoins or forgets it.
 *
 * Saved networks lead, and the scan sits a page further in (Add network),
 * because switching between known sites is the common case and a scan costs
 * ~45 s of radio time to answer a question the robot already knows. A saved
 * network is rejoined with the password the robot kept, so no card asks for one.
 *
 * Which card is live comes from the state poll, not the list's own `active`:
 * the list is only read again after a write, and the robot can roam on its own.
 */
export function WifiConnections() {
  const saved = useWifiConnections();
  const wifi = useWifiConnect();

  const currentSsid = wifi.current?.ssid || null;
  const ordered = React.useMemo(
    () => orderConnections(saved.connections ?? [], currentSsid),
    [saved.connections, currentSsid],
  );

  return (
    <div className="space-y-6">
      <CurrentNetwork wifi={wifi} />

      <section aria-labelledby="saved-networks" className="space-y-3">
        <h2 id="saved-networks" className="instrument-label text-muted-foreground">
          Saved networks
        </h2>

        {saved.status === "loading" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        ) : saved.status === "error" ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              {/* The backend's sentence, verbatim. */}
              <p role="alert" className="text-sm text-signal-warn">
                {saved.error}
              </p>
              <Button variant="outline" size="sm" onClick={saved.retry}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : ordered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <WifiIcon className="size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-sm text-muted-foreground">
                No saved networks yet. A network the robot joins is saved here.
              </p>
              <Link href={ADD_NETWORK_HREF} className={buttonVariants({ size: "sm" })}>
                <PlusIcon data-icon="inline-start" />
                Add network
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((connection) => (
              <li key={connection.uuid} className="min-w-0">
                <SavedNetworkCard
                  connection={connection}
                  live={
                    currentSsid === null
                      ? connection.active
                      : connection.ssid === currentSsid
                  }
                  readAtMs={saved.readAtMs}
                  wifi={wifi}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The robot's own reading of its network: what it is on, and the addresses an
 * engineer reaches it by. A readout, not a control — moving it is the cards'.
 */
function CurrentNetwork({ wifi }: { wifi: WifiConnect }) {
  const current = wifi.current;
  const currentSsid = current?.ssid || null;

  return (
    <Card>
      <CardContent className="space-y-2">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div className="min-w-0 space-y-0.5">
            <dt className="text-muted-foreground">Connected to</dt>
            <dd className="flex min-w-0 items-center gap-2 font-medium">
              {currentSsid && current ? (
                <>
                  <SignalBars bars={rssiToBars(current.rssi)} tone="live" />
                  <span className="truncate">{current.ssid}</span>
                  <span className="readout text-[11px] text-muted-foreground">
                    {current.rssi} dBm
                  </span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">Current IP</dt>
            <dd className="font-medium tabular-nums">{current?.ip_address || "—"}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">MAC address</dt>
            <dd className="font-medium tabular-nums">{current?.mac_address || "—"}</dd>
          </div>
        </dl>
        {!current && (
          <Hint>
            {wifi.stateStatus === "loading"
              ? "Waiting for the robot to report in."
              : "This console cannot reach the robot, so its current network is unknown."}
          </Hint>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One saved network. Connect rejoins it; Forget deletes it behind a dialog.
 *
 * The live network's card has neither: it is already joined, and the robot
 * refuses to forget the network it is on — forgetting it would take the robot
 * off the network, quite possibly the one this console reaches it over.
 *
 * The join hook is shared by every card (the robot can only join one network
 * at a time, so one Connect in flight disables the rest), so a card shows the
 * hook's lines only when the join was a rejoin of *this* network.
 */
function SavedNetworkCard({
  connection,
  live,
  readAtMs,
  wifi,
}: {
  connection: WifiConnection;
  live: boolean;
  readAtMs: number;
  wifi: WifiConnect;
}) {
  const forget = useForgetWifiConnection();
  const [confirming, setConfirming] = React.useState(false);

  const mine = wifi.savedTarget === connection.uuid;
  const joining = mine && wifi.busy;
  const pending = mine && wifi.pending !== null;

  const closeDialog = () => {
    setConfirming(false);
    forget.reset();
  };

  return (
    <Card className={cn("h-full", live && "ring-signal-live/40")}>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <WifiIcon
            className={cn("size-4 shrink-0", live ? "text-signal-live" : "text-muted-foreground")}
            aria-hidden
          />
          <span className="truncate">{connection.ssid}</span>
        </CardTitle>
        {live && (
          <CardAction>
            <Chip tone="live">Connected</Chip>
          </CardAction>
        )}
        <CardDescription className="text-xs">
          {lastUsedLabel(connection.last_used_at, readAtMs)}
          {connection.name !== connection.ssid && (
            <span className="block truncate">Saved as {connection.name}</span>
          )}
        </CardDescription>
      </CardHeader>

      {mine && (pending || wifi.message || wifi.error) && (
        <CardContent className="space-y-1">
          {/* In place rather than a toast, as on Add network: the operator is
              watching this card until the robot lands. */}
          {pending && (
            <Hint className="text-signal-caution">
              Connecting to <span className="readout">{wifi.pending}</span>… the
              robot reports its network once a second.
            </Hint>
          )}
          {wifi.message && <Hint className="text-signal-live">{wifi.message}</Hint>}
          {wifi.error && (
            <Hint role="alert" className="text-signal-warn">
              {wifi.error}
            </Hint>
          )}
        </CardContent>
      )}

      {!live && (
        <CardFooter className="mt-auto justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={joining}
            onClick={() => {
              forget.reset();
              setConfirming(true);
            }}
            aria-label={`Forget ${connection.ssid}`}
          >
            <Trash2Icon data-icon="inline-start" />
            Forget
          </Button>
          <Button
            size="sm"
            disabled={wifi.busy}
            onClick={() => void wifi.activate(connection)}
            aria-label={`Connect to ${connection.ssid}`}
          >
            <WifiIcon data-icon="inline-start" />
            {joining ? "Connecting…" : "Connect"}
          </Button>
        </CardFooter>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !forget.isPending) closeDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget {connection.ssid}?</AlertDialogTitle>
            <AlertDialogDescription>
              The robot will stop joining it, and joining it again will need its
              password.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {forget.error && (
            <p role="alert" className="text-[11px] leading-tight text-signal-warn">
              {forget.error.message}
            </p>
          )}

          <AlertDialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={forget.isPending}
              onClick={closeDialog}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Keep
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={forget.isPending}
              onClick={() =>
                forget.mutate(connection.uuid, { onSuccess: () => setConfirming(false) })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              {forget.isPending ? "Forgetting…" : "Forget"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Hint({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[11px] leading-snug text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  );
}
