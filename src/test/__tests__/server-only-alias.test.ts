// Loading this file at all is the assertion: without the vitest alias, the real
// `server-only` package throws on import outside a react-server bundle (or is missing).
import "server-only";
import { describe, expect, it } from "vitest";
import * as stub from "@/test/server-only-stub";

describe("server-only alias", () => {
  it("resolves `server-only` to an empty stub so server modules can be unit-tested", () => {
    expect(Object.keys(stub)).toEqual([]);
  });
});
