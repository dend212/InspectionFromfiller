import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn (className utility)", () => {
  it("merges multiple class names", () => {
    const result = cn("px-4", "py-2");
    expect(result).toBe("px-4 py-2");
  });

  it("handles empty arguments", () => {
    const result = cn();
    expect(result).toBe("");
  });

  it("handles single class name", () => {
    const result = cn("px-4");
    expect(result).toBe("px-4");
  });

  it("handles undefined and null values", () => {
    const result = cn("px-4", undefined, null, "py-2");
    expect(result).toBe("px-4 py-2");
  });

  it("handles false and empty string", () => {
    const result = cn("px-4", false, "", "py-2");
    expect(result).toBe("px-4 py-2");
  });

  it("merges conflicting Tailwind classes (last wins)", () => {
    const result = cn("px-4", "px-8");
    expect(result).toBe("px-8");
  });

  it("merges conflicting Tailwind color classes", () => {
    const result = cn("text-red-500", "text-blue-500");
    expect(result).toBe("text-blue-500");
  });

  it("handles conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn("base", isActive && "active", isDisabled && "disabled");
    expect(result).toBe("base active");
  });

  it("handles array of classes", () => {
    const result = cn(["px-4", "py-2"]);
    expect(result).toBe("px-4 py-2");
  });

  it("handles object syntax from clsx", () => {
    const result = cn({ "px-4": true, "py-2": true, "hidden": false });
    expect(result).toBe("px-4 py-2");
  });

  it("handles mixed types", () => {
    const result = cn("base", ["flex", "items-center"], {
      "bg-red-500": true,
    });
    expect(result).toBe("base flex items-center bg-red-500");
  });

  it("deduplicates Tailwind responsive variants", () => {
    const result = cn("md:px-4", "md:px-8");
    expect(result).toBe("md:px-8");
  });
});
