import { cn } from "@/lib/utils";

/**
 * A refusal, said where the operator is looking: the backend's own sentence,
 * announced (`role="alert"`) and in the fault hue. One component because the
 * line was hand-written at every write, and its leading and wrapping had
 * drifted apart for no reason anyone chose.
 *
 * `break-words` always: a sentence may carry a map or a job name, which has
 * no spaces to wrap at. Renders nothing for no message, so a caller passes
 * `mutation.error?.message` as it is.
 */
export function ErrorLine({
  children,
  tone = "warn",
  className,
}: {
  children: React.ReactNode;
  /** `caution` for a refusal that clears on its own (the robot is busy). */
  tone?: "warn" | "caution";
  className?: string;
}) {
  if (children === null || children === undefined || children === false || children === "") {
    return null;
  }
  return (
    <p
      role="alert"
      className={cn(
        "text-[11px] leading-snug break-words",
        tone === "caution" ? "text-signal-caution" : "text-signal-warn",
        className,
      )}
    >
      {children}
    </p>
  );
}
