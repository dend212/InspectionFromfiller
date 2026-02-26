import type { z } from "zod";
import type {
  facilityInfoSchema,
  generalTreatmentSchema,
  designFlowSchema,
  septicTankSchema,
  disposalWorksSchema,
  inspectionFormSchema,
} from "@/lib/validators/inspection";

export type FacilityInfo = z.infer<typeof facilityInfoSchema>;
export type GeneralTreatment = z.infer<typeof generalTreatmentSchema>;
export type DesignFlow = z.infer<typeof designFlowSchema>;
export type SepticTank = z.infer<typeof septicTankSchema>;
export type DisposalWorks = z.infer<typeof disposalWorksSchema>;
export type InspectionFormData = z.infer<typeof inspectionFormSchema>;
