"use client";

import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { draftWouldBeLost } from "@/lib/task/draft-store";

/**
 * Opens the editor on a new job.
 *
 * The draft outlives the editor's page, so there may be unsaved steps waiting
 * in it that the operator cannot see from here. Asked rather than cleared:
 * OK starts empty, Cancel still opens the editor — on the work they kept,
 * which is the likelier reason they pressed it at all.
 */
export function CreateTaskButton() {
  const router = useRouter();
  const [draft, , clearDraft] = useTaskDraft();

  const create = () => {
    if (
      !draftWouldBeLost(draft, null) ||
      window.confirm("Clear the unsaved steps in the editor and start a new task?")
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
