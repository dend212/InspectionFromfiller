import type { InferInsertModel } from "drizzle-orm";
import type { checklistTemplateItems, jobChecklistItems } from "@/lib/db/schema";

type TemplateItem = InferInsertModel<typeof checklistTemplateItems> & {
  id?: string;
  createdAt?: Date;
};

type JobChecklistItemInsert = InferInsertModel<typeof jobChecklistItems>;

/**
 * Pure function: map template items into the insert shape for a job's
 * checklist snapshot. Does not touch the database — caller is responsible
 * for wrapping the INSERT in a transaction with the job row.
 *
 * Snapshot semantics: after a job is created, later edits to the template
 * MUST NOT affect the job. That is why the fields are copied by value and
 * the sourceTemplateId on `jobs` is only informational.
 */
export function mapTemplateItemsToJobItems(
  jobId: string,
  templateItems: Array<
    Pick<
      TemplateItem,
      "title" | "instructions" | "requiredPhotoCount" | "requiresNote" | "isRequired" | "sortOrder"
    >
  >,
): JobChecklistItemInsert[] {
  return templateItems
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((item, index) => ({
      jobId,
      title: item.title,
      instructions: item.instructions ?? null,
      requiredPhotoCount: item.requiredPhotoCount ?? 0,
      requiresNote: item.requiresNote ?? false,
      isRequired: item.isRequired ?? true,
      sortOrder: index,
      status: "pending",
    }));
}
