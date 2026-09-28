import { describe, expect, it } from "vitest";

import { TASK_TEMPLATE_NAME_MAX, taskTemplateNameOk } from "@/lib/task/template";

describe("taskTemplateNameOk", () => {
  it("refuses a blank name, which the backend would answer with a 422 array", () => {
    expect(taskTemplateNameOk("")).toBe(false);
    expect(taskTemplateNameOk("   ")).toBe(false);
  });

  it("measures the name as it will be stored, trimmed", () => {
    expect(taskTemplateNameOk("  Morning patrol  ")).toBe(true);
    expect(taskTemplateNameOk(` ${"x".repeat(TASK_TEMPLATE_NAME_MAX)} `)).toBe(true);
    expect(taskTemplateNameOk("x".repeat(TASK_TEMPLATE_NAME_MAX + 1))).toBe(false);
  });
});
