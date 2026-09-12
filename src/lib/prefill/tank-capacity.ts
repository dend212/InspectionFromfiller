import type { UseFormReturn } from "react-hook-form";
import { createEmptyTank } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { normalizeFieldPath } from "./merge";

/** Matches "septicTank.tanks.<index>.<field>" once normalizeFieldPath has turned [i] into .i */
export const TANK_FIELD_RE = /^septicTank\.tanks\.(\d+)\.(.+)$/;

/**
 * A write targeting `septicTank.tanks.<i>.<field>` needs the tanks array to be at least
 * `i + 1` long before `form.setValue` can reach it. Grows it with blank tanks (the same
 * shape step-septic-tank.tsx uses) and bumps numberOfTanks to match when it's empty or
 * smaller than the grown length. Shared by the prefill apply path, acceptSuggestion and
 * the scan flow so all three grow the array the same way. Accepts bracket or dotted paths.
 */
export function ensureTankArrayCapacity(
  form: UseFormReturn<InspectionFormData>,
  fieldPaths: readonly string[],
): void {
  let maxIndex = -1;
  for (const fieldPath of fieldPaths) {
    const match = TANK_FIELD_RE.exec(normalizeFieldPath(fieldPath));
    if (match) {
      const index = Number.parseInt(match[1], 10);
      if (index > maxIndex) maxIndex = index;
    }
  }
  if (maxIndex < 0) return;

  const requiredLength = maxIndex + 1;
  const currentTanks = form.getValues("septicTank.tanks") ?? [];
  if (currentTanks.length >= requiredLength) return;

  const grown = [...currentTanks];
  while (grown.length < requiredLength) {
    grown.push(createEmptyTank());
  }
  form.setValue("septicTank.tanks", grown);

  const currentCount = form.getValues("septicTank.numberOfTanks");
  if (!currentCount || Number.parseInt(currentCount, 10) < requiredLength) {
    form.setValue("septicTank.numberOfTanks", String(requiredLength));
  }
}
