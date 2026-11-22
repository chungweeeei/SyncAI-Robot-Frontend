"use client";

import * as React from "react";

import {
  Chip,
  GroupToggle,
  InstrumentGroup,
  Readout,
  Segmented,
} from "@/components/console/instrument";
import { useLocomotion, type Controller, type Policy } from "@/hooks/use-locomotion";
import type { RobotLowLevelMode } from "@/lib/types/robot";

const CONTROLLERS: readonly { value: Controller; label: string }[] = [
  { value: "RL", label: "RL" },
  { value: "MPC", label: "MPC" },
];

const POLICIES: readonly { value: Policy; label: string }[] = [
  { value: "PPO", label: "PPO" },
  { value: "HIMLOCO", label: "HIMLOCO" },
];

/**
 * Locomotion controller and policy: modes the robot stays in, hence Segmented.
 * The two rows are different kinds of value, and the labels say so:
 *
 * - **Controller** is commanded (default RL) and cannot be read back, so the
 *   lit segment is the last press — except an arrival at IDLE or LOCOMOTION
 *   drops MPC back to RL (`controllerAfterMotion`).
 * - **Policy** is reported (`low_level_mode.policy`); an unconfirmed request
 *   shows as `confirming…` rather than looking applied. Disabled under MPC,
 *   since a policy only means anything under RL.
 *
 * Folded by default: these are how the robot walks, set while commissioning
 * and rarely touched after, and the screen people watch a patrol on (and
 * show a customer) was spending a third of its rail on two algorithm names.
 * It opens on its own while a request is unconfirmed or refused, so the
 * answer to a press is never folded away.
 */
export function LocomotionControl({
  lowLevelMode,
}: {
  lowLevelMode: RobotLowLevelMode;
}) {
  const {
    controller,
    policy,
    pendingPolicy,
    busy,
    error,
    selectController,
    selectPolicy,
  } = useLocomotion(lowLevelMode);

  const mpc = controller === "MPC";
  const bodyId = React.useId();
  const [chosen, setChosen] = React.useState(false);
  const open = chosen || Boolean(pendingPolicy) || Boolean(error) || policy === null;

  return (
    <InstrumentGroup
      label="Locomotion"
      action={
        <span className="flex items-center gap-1.5">
          {pendingPolicy && <Chip tone="caution">Confirming</Chip>}
          <GroupToggle
            open={open}
            onToggle={() => setChosen(!open)}
            controls={bodyId}
            what="locomotion settings"
          />
        </span>
      }
    >
      {!open ? (
        <p id={bodyId} className="text-[12px] leading-snug text-muted-foreground">
          How the robot walks. Show to change it.
        </p>
      ) : (
        <div id={bodyId} className="space-y-1.5">
          <Row label="Controller · commanded">
            <Segmented
              label="Controller"
              stretch
              value={controller}
              options={CONTROLLERS}
              onChange={selectController}
              disabled={busy}
            />
          </Row>

          <Row
            label={
              mpc
                ? "Policy · RL only"
                : pendingPolicy
                  ? `Policy · confirming ${pendingPolicy}…`
                  : "Policy · reported"
            }
          >
            <Segmented
              label="Policy"
              stretch
              value={policy}
              options={POLICIES}
              onChange={selectPolicy}
              disabled={busy || mpc}
            />
          </Row>

          {/* A reported policy this control cannot ask for must still be visible. */}
          {policy === null && (
            <Readout label="Reported" value={lowLevelMode.policy} tone="caution" />
          )}

          {error && (
            <p className="text-[11px] leading-snug break-words text-signal-warn">
              {error}
            </p>
          )}
        </div>
      )}
    </InstrumentGroup>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="instrument-label mb-1 text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
