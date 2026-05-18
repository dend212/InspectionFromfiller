import { describe, expect, it } from "vitest";
import {
  hasAlternativeSystemData,
  normalizeIncludeAlternativePages,
} from "@/lib/inspection-form";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const baseForm = (): InspectionFormData =>
  getDefaultFormValues("Test Inspector") as unknown as InspectionFormData;

describe("hasAlternativeSystemData", () => {
  it("returns false for null", () => {
    expect(hasAlternativeSystemData(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasAlternativeSystemData(undefined)).toBe(false);
  });

  it("returns false when alternativeSystem is missing", () => {
    const data = baseForm();
    delete (data as Partial<InspectionFormData>).alternativeSystem;
    expect(hasAlternativeSystemData(data)).toBe(false);
  });

  it("returns false for an alternativeSystem subtree containing only defaults from getDefaultFormValues except inspector identity strings", () => {
    // The default subtree pre-fills inspector name as qualifiedInspector/contactName/altPrintedName/orgResponsible,
    // which are still considered "data" by the helper — so a clean default subtree is treated as alt data.
    // We confirm that an explicitly-empty subtree returns false.
    const data = baseForm();
    if (data.alternativeSystem) {
      data.alternativeSystem.qualifiedInspector = "";
      data.alternativeSystem.contactName = "";
      data.alternativeSystem.altPrintedName = "";
      data.alternativeSystem.orgResponsible = "";
    }
    expect(hasAlternativeSystemData(data)).toBe(false);
  });

  it("returns true when a single string field is filled", () => {
    const data = baseForm();
    if (data.alternativeSystem) {
      data.alternativeSystem.qualifiedInspector = "";
      data.alternativeSystem.contactName = "";
      data.alternativeSystem.altPrintedName = "";
      data.alternativeSystem.orgResponsible = "";
      data.alternativeSystem.manufacturer = "Acme Aerobic";
    }
    expect(hasAlternativeSystemData(data)).toBe(true);
  });

  it("returns true when a multi-select array has entries", () => {
    const data = baseForm();
    if (data.alternativeSystem) {
      data.alternativeSystem.qualifiedInspector = "";
      data.alternativeSystem.contactName = "";
      data.alternativeSystem.altPrintedName = "";
      data.alternativeSystem.orgResponsible = "";
      data.alternativeSystem.altDisposalTypes = ["trench"];
    }
    expect(hasAlternativeSystemData(data)).toBe(true);
  });

  it("returns true when a deficiency boolean is checked", () => {
    const data = baseForm();
    if (data.alternativeSystem) {
      data.alternativeSystem.qualifiedInspector = "";
      data.alternativeSystem.contactName = "";
      data.alternativeSystem.altPrintedName = "";
      data.alternativeSystem.orgResponsible = "";
      data.alternativeSystem.altDefRootInvasion = true;
    }
    expect(hasAlternativeSystemData(data)).toBe(true);
  });
});

describe("normalizeIncludeAlternativePages", () => {
  it("returns null for null formData", () => {
    expect(normalizeIncludeAlternativePages(null)).toBeNull();
  });

  it("preserves includeAlternativePages=true verbatim", () => {
    const data = baseForm();
    data.includeAlternativePages = true;
    const result = normalizeIncludeAlternativePages(data);
    expect(result?.includeAlternativePages).toBe(true);
  });

  it("derives includeAlternativePages=true from saved alt-system data when flag is false", () => {
    // This is the regression case: tech enabled alt pages and filled them; somewhere
    // upstream the top-level flag got reset to false, but the data is still in formData.
    const data = baseForm();
    data.includeAlternativePages = false;
    if (data.alternativeSystem) {
      data.alternativeSystem.manufacturer = "Acme Aerobic";
    }
    const result = normalizeIncludeAlternativePages(data);
    expect(result?.includeAlternativePages).toBe(true);
  });

  it("derives includeAlternativePages=true from saved alt-system data when flag is missing", () => {
    const data = baseForm();
    delete (data as Partial<InspectionFormData>).includeAlternativePages;
    if (data.alternativeSystem) {
      data.alternativeSystem.altDefRootInvasion = true;
    }
    const result = normalizeIncludeAlternativePages(data);
    expect(result?.includeAlternativePages).toBe(true);
  });

  it("leaves includeAlternativePages=false when alt-system subtree has no data", () => {
    const data = baseForm();
    data.includeAlternativePages = false;
    if (data.alternativeSystem) {
      data.alternativeSystem.qualifiedInspector = "";
      data.alternativeSystem.contactName = "";
      data.alternativeSystem.altPrintedName = "";
      data.alternativeSystem.orgResponsible = "";
    }
    const result = normalizeIncludeAlternativePages(data);
    expect(result?.includeAlternativePages).toBe(false);
  });

  it("does not mutate the original formData", () => {
    const data = baseForm();
    data.includeAlternativePages = false;
    if (data.alternativeSystem) {
      data.alternativeSystem.manufacturer = "Acme";
    }
    const before = data.includeAlternativePages;
    normalizeIncludeAlternativePages(data);
    expect(data.includeAlternativePages).toBe(before);
  });
});
