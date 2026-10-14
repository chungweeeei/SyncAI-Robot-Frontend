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
import {
  IP_BLANK,
  MAC_BLANK,
  RSSI_BLANK,
  lastUsedLabel,
  linkReadout,
  orderConnections,
  type LinkReadout,
} from "@/lib/network/connections";
import { cn } from "@/lib/utils";

/** Where Add network goes; the page's header and the empty state both link it. */
export const ADD_NETWORK_HREF = "/settings/wifi/new";

/**
 * The Wi-Fi page: each network the robot has saved, as a card that rejoins or
 * forgets it, the live one first with its signal and addresses.
 *
 * Saved networks lead and the scan is a page in (Add network): switching
 * between known sites is the common case, and a scan costs ~45 s of radio.
 * Which card is live comes from the state poll, not the list's `active` — the
 * list is only re-read after a write, and the robot can roam on its own.
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
 * One saved network. Connect rejoins it; Forget deletes it behind a dialog.
 *
 * Every card has the signal and address rows (blank off the live network) so
 * the grid lines up. The live card has neither button: it is already joined,
 * and the robot refuses to forget the network it is on.
 *
 * The join hook is shared by every card (one join at a time), so a card shows
 * its lines only when the join was a rejoin of this network.
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

      <CardContent className="space-y-2">
        <LinkDetails readout={linkReadout(connection.ssid, wifi.current)} />

        {/* Live by the list's flag but no state frame yet: say why the rows
            are blank. */}
        {live && !wifi.current && (
          <Hint>
            {wifi.stateStatus === "loading"
              ? "Waiting for the robot to report in."
              : "This console cannot reach the robot, so its signal and addresses are unknown."}
          </Hint>
        )}

        {/* In place rather than a toast, as on Add network. */}
        {pending && (
          <Hint className="text-signal-caution">
            Connecting to <span className="readout">{wifi.pending}</span>… the
            robot reports its network once a second.
          </Hint>
        )}
        {mine && wifi.message && <Hint className="text-signal-live">{wifi.message}</Hint>}
        {mine && wifi.error && (
          <Hint role="alert" className="text-signal-warn">
            {wifi.error}
          </Hint>
        )}
      </CardContent>

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

/** The card's link rows: label on the left, the reading or its blank on the right. */
function LinkDetails({ readout }: { readout: LinkReadout }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <LinkRow label="Signal">
        {readout.rssi === null ? (
          <Blank>
            <SignalBars bars={0} tone="neutral" />
            {RSSI_BLANK}
          </Blank>
        ) : (
          <>
            <SignalBars bars={rssiToBars(readout.rssi)} tone="live" />
            {readout.rssi} dBm
          </>
        )}
      </LinkRow>
      <LinkRow label="Current IP">{readout.ip ?? <Blank>{IP_BLANK}</Blank>}</LinkRow>
      <LinkRow label="MAC address">{readout.mac ?? <Blank>{MAC_BLANK}</Blank>}</LinkRow>
    </dl>
  );
}

function LinkRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // Wraps rather than truncates: at lg a card is just short of a MAC address
    // beside its label, and a clipped address is worse.
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="readout ml-auto flex items-center gap-2 whitespace-nowrap">{children}</dd>
    </div>
  );
}

/**
 * A value's blank, hidden from a screen reader (which would spell out every
 * dash) and replaced there by the fact it stands for.
 */
function Blank({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden className="flex items-center gap-2 text-muted-foreground">
        {children}
      </span>
      <span className="sr-only">Not connected</span>
    </>
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
