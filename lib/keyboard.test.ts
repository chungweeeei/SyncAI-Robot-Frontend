import { describe, expect, it } from "vitest";

import { isTypingTarget } from "@/lib/keyboard";

function input(type: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

describe("isTypingTarget", () => {
  it("leaves the drive keys alone once a slider or a toggle has focus", () => {
    // The regression: a focused Max speed slider swallowed W/A/S/D.
    for (const type of ["range", "checkbox", "radio", "button", "submit"]) {
      expect(isTypingTarget(input(type)), type).toBe(false);
    }
  });

  it("guards every field a letter can land in", () => {
    for (const type of ["text", "search", "number", "password", "email"]) {
      expect(isTypingTarget(input(type)), type).toBe(true);
    }
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("passes keys aimed at the page itself", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
  });
});
