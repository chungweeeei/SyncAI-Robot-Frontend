import { Card, CardContent } from "@/components/ui/card";

/**
 * A settings section the robot can't be configured for yet. The route exists
 * ahead of the backend, by request, and says so rather than show a form that
 * saves nothing.
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
