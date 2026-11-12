"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EraserIcon, PlusIcon } from "lucide-react";

import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { draftWouldBeLost } from "@/lib/task/draft-store";

/**
 * Opens the editor on a new job. Unsaved work in the draft is asked about:
 * Clear starts empty, Keep changes still opens the editor on the kept work,
 * and closing the question opens nothing. An untouched saved job is not
 * unsaved work (hence the library read).
 */
export function CreateTaskButton() {
  const router = useRouter();
  const [draft, , clearDraft] = useTaskDraft();
  const { templates } = useTaskTemplates();
  const [asking, setAsking] = React.useState(false);

  const openEditor = (clear: boolean) => {
    if (clear) clearDraft();
    router.push("/tasks/editor");
  };

  const create = () => {
    if (draftWouldBeLost(draft, null, templates)) setAsking(true);
    else openEditor(true);
  };

  return (
    <>
      <Button onClick={create} className="pointer-coarse:min-h-10">
        <PlusIcon data-icon="inline-start" aria-hidden />
        Create task
      </Button>

      <ConfirmDialog
        open={asking}
        title="Start a new task?"
        verb="Clear and start"
        verbIcon={EraserIcon}
        keepLabel="Keep changes"
        onConfirm={() => openEditor(true)}
        onKeep={() => openEditor(false)}
        onClose={() => setAsking(false)}
      >
        The unsaved changes in the editor will be cleared.
      </ConfirmDialog>
    </>
  );
}
