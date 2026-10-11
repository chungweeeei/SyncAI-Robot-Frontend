import { Card, CardContent } from "@/components/ui/card";

/**
 * A settings section the robot cannot be configured for yet. The route and
 * its card exist ahead of the backend, by request; until then the page says
 * so plainly, because a form that looked settable but saved nothing was
 * worse than none (see NetworkSettings).
 */
export function UnavailableSettings({ section }: { section: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {section} settings are not available on this robot yet.
        </p>
      </CardContent>
    </Card>
  );
}
