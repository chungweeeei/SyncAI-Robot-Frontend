"use client";

import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { draftWouldBeLost } from "@/lib/task/draft-store";

/**
 * Opens the editor on a new job.
 *
 * The draft outlives the editor's page, so there may be unsaved steps waiting
 * in it that the operator cannot see from here. Asked rather than cleared:
 * OK starts empty, Cancel still opens the editor — on the work they kept,
 * which is the likelier reason they pressed it at all. A saved job opened and
 * left untouched is not unsaved work, which is what the library is read for.
 */
export function CreateTaskButton() {
  const router = useRouter();
  const [draft, , clearDraft] = useTaskDraft();
  const { templates } = useTaskTemplates();

  const create = () => {
    if (
      !draftWouldBeLost(draft, null, templates) ||
      window.confirm("Clear the unsaved changes in the editor and start a new task?")
    ) {
      clearDraft();
    }
    router.push("/tasks/editor");
  };

  return (
    <Button onClick={create} className="pointer-coarse:min-h-10">
      <PlusIcon data-icon="inline-start" aria-hidden />
      Create task
    </Button>
  );
}
