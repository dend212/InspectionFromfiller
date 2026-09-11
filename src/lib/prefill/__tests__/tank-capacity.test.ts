import { renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { ensureTankArrayCapacity } from "@/lib/prefill/tank-capacity";
import { createEmptyTank, getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

type Tank = InspectionFormData["septicTank"]["tanks"][number];

function makeForm(tanks: Tank[], numberOfTanks = "") {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  const { result } = renderHook(() =>
    useForm<InspectionFormData>({
      defaultValues: { ...defaults, septicTank: { ...defaults.septicTank, tanks, numberOfTanks } },
    }),
  );
  return result.current;
}

describe("ensureTankArrayCapacity", () => {
  it("grows the tanks array with blank tanks up to the highest index and bumps numberOfTanks", () => {
    const form = makeForm([]);
    ensureTankArrayCapacity(form, ["facilityInfo.facilityName", "septicTank.tanks.1.tankCapacity"]);
    expect(form.getValues("septicTank.tanks")).toEqual([createEmptyTank(), createEmptyTank()]);
    expect(form.getValues("septicTank.numberOfTanks")).toBe("2");
  });

  it("accepts bracket paths (scan flow) as well as dotted ones", () => {
    const form = makeForm([]);
    ensureTankArrayCapacity(form, ["septicTank.tanks[2].tankMaterial"]);
    expect(form.getValues("septicTank.tanks")).toHaveLength(3);
    expect(form.getValues("septicTank.numberOfTanks")).toBe("3");
  });

  it("is a no-op when the array is already long enough and never lowers numberOfTanks", () => {
    const existing = { ...createEmptyTank(), tankCapacity: "1250" };
    const form = makeForm([existing, createEmptyTank()], "3");
    ensureTankArrayCapacity(form, ["septicTank.tanks.0.tankCapacity"]);
    expect(form.getValues("septicTank.tanks")).toEqual([existing, createEmptyTank()]);
    expect(form.getValues("septicTank.numberOfTanks")).toBe("3");
  });

  it("does nothing for paths outside the tanks array", () => {
    const form = makeForm([]);
    ensureTankArrayCapacity(form, ["facilityInfo.facilityName", "designFlow.numberOfBedrooms"]);
    expect(form.getValues("septicTank.tanks")).toEqual([]);
    expect(form.getValues("septicTank.numberOfTanks")).toBe("");
  });
});
