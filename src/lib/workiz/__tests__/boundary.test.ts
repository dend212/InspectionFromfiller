import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Second line of defence behind `import "server-only"` in client.ts (spec §12): no client
 * component and nothing under src/components may import the Workiz server modules.
 */
const SRC = join(process.cwd(), "src");
const WORKIZ_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*lib\/workiz(?:\/[^"']*)?["']/;
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Workiz client boundary", () => {
  it("the detectors work", () => {
    expect(WORKIZ_IMPORT.test('import { workizGet } from "@/lib/workiz/client";')).toBe(true);
    expect(WORKIZ_IMPORT.test('import type { WorkizJob } from "../../lib/workiz/schema";')).toBe(true);
    expect(WORKIZ_IMPORT.test('import type { WorkizJobsResponse } from "@/types/workiz-import";')).toBe(false);
    expect(USE_CLIENT.test('"use client";\nimport x from "y";')).toBe(true);
    expect(USE_CLIENT.test('import x from "y";\n// "use client"')).toBe(false);
  });

  it('no "use client" file and nothing under src/components imports @/lib/workiz/*', () => {
    const offenders = walk(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        const inComponents = relative(SRC, file).split(sep)[0] === "components";
        return (inComponents || USE_CLIENT.test(text)) && WORKIZ_IMPORT.test(text);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
