import { describe, expect, it } from "vitest";
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { findApnHint } from "@/lib/workiz/apn-hint";
import { BOT_NOTES, cf, job, note } from "./fixtures/jobs";

const withNotes = (...notes: Array<Record<string, unknown>>) => job({ notes });

describe("findApnHint (spec §5.3)", () => {
  it("the APN custom field wins over any note (0.7)", () => {
    const result = findApnHint(
      job({ customFields: [cf(WORKIZ_CF.apn, "12345670")], notes: [BOT_NOTES.grokHigh] }),
    );
    expect(result).toEqual({
      hint: { apn: "123-45-670", confidence: 0.7, source: "custom_field" },
      customFieldInvalid: false,
    });
  });

  it("an invalid custom field is flagged and the notes are used instead", () => {
    const result = findApnHint(job({ customFields: [cf(WORKIZ_CF.apn, "see notes")], notes: [BOT_NOTES.grokHigh] }));
    expect(result.customFieldInvalid).toBe(true);
    expect(result.hint).toMatchObject({ apn: "123-45-678", source: "note" });
  });

  it("an empty custom field is not 'invalid'", () => {
    expect(findApnHint(job({ customFields: [cf(WORKIZ_CF.apn, "  ")] }))).toEqual({ hint: null, customFieldInvalid: false });
  });

  it.each([
    [BOT_NOTES.grokHigh, "123-45-678", 0.6, "high"],
    [BOT_NOTES.plainHighSuffix, "123-45-678K", 0.6, "high"],
    [BOT_NOTES.parenthesizedMedium, "123-45-678Z", 0.5, "medium"],
    [BOT_NOTES.grokLow, "123-45-680", 0.4, "low"],
    [BOT_NOTES.noConfidence, "123-45-679", 0.4, "unstated"],
  ])("reads note shape %#", (shape, apn, confidence, noteConfidence) => {
    expect(findApnHint(withNotes(shape)).hint).toEqual({ apn, confidence, source: "note", noteConfidence });
  });

  it("uses only the newest permit-bot note", () => {
    expect(findApnHint(withNotes(BOT_NOTES.grokLow, BOT_NOTES.grokHigh)).hint?.apn).toBe("123-45-680");
  });

  it("ignores notes that are not permit-bot notes", () => {
    expect(findApnHint(withNotes(BOT_NOTES.notABotNote)).hint).toBeNull();
  });

  it("duplicate bot notes collapse naturally", () => {
    const dup = BOT_NOTES.grokHigh;
    expect(findApnHint(withNotes(dup, dup, dup)).hint).toMatchObject({ apn: "123-45-678", confidence: 0.6 });
  });

  it("an unparseable timestamp sorts oldest", () => {
    const undated = note("Permit added. Confidence high. APN 123-45-690.", "yesterday");
    expect(findApnHint(withNotes(undated, BOT_NOTES.grokLow)).hint?.apn).toBe("123-45-680");
  });

  it("no custom field and no bot note → no hint", () => {
    expect(findApnHint(job())).toEqual({ hint: null, customFieldInvalid: false });
  });
});
