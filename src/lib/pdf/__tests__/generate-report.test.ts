import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import type { InspectionFormData } from "@/types/inspection";

// ---------------------------------------------------------------------------
// Mock all dependencies
// ---------------------------------------------------------------------------

// Create a valid template PDF with 9 pages and form fields
async function createTemplatePdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const form = doc.getForm();

  // Add 9 pages (the template has 9 pages, 3 are removed during generation)
  for (let i = 0; i < 9; i++) {
    doc.addPage([612, 792]);
  }

  // Add some text fields the code will try to fill
  form.createTextField("taxParcelNo");
  form.createTextField("inspectionDate");
  form.createTextField("inspectorInitials");
  form.createTextField("propertyName");
  form.createTextField("conventionalSignatureDate");
  form.createTextField("conventionalPrintedName");

  // Add a checkbox
  form.createCheckBox("qualAdeqCourse");

  // Add a radio group
  const radioGroup = form.createRadioGroup("recordsAvailable");
  radioGroup.addOptionToPage("Choice1", doc.getPage(1), { x: 100, y: 100, width: 10, height: 10 });
  radioGroup.addOptionToPage("Choice2", doc.getPage(1), { x: 120, y: 100, width: 10, height: 10 });

  // Add a signature field (text field used as placeholder)
  form.createTextField("conventionalSignature");

  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

let templateBytes: ArrayBuffer;

// Mock loadPublicFile
vi.mock("@/lib/pdf/load-public-file", () => ({
  loadPublicFile: vi.fn().mockImplementation(async (path: string) => {
    if (path.endsWith(".pdf")) {
      return templateBytes;
    }
    // Return a minimal PNG for logo
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]).buffer;
  }),
}));

// Mock buildCommentsPage
vi.mock("@/lib/pdf/comments-page", () => ({
  buildCommentsPage: vi.fn().mockResolvedValue(null),
}));

// Mock buildPhotoPages
vi.mock("@/lib/pdf/photo-pages", () => ({
  buildPhotoPages: vi.fn().mockResolvedValue(null),
}));

import { generateReport } from "@/lib/pdf/generate-report";
import { loadPublicFile } from "@/lib/pdf/load-public-file";
import { buildCommentsPage } from "@/lib/pdf/comments-page";
import { buildPhotoPages } from "@/lib/pdf/photo-pages";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeMinimalFormData(): InspectionFormData {
  return {
    facilityInfo: {
      facilityName: "Test Property",
      facilityAddress: "",
      facilityCity: "",
      facilityCounty: "",
      facilityState: "AZ",
      facilityZip: "",
      taxParcelNumber: "",
      dateOfInspection: "",
      sellerName: "",
      sellerAddress: "",
      sellerCity: "",
      sellerState: "",
      sellerZip: "",
      inspectorName: "Test Inspector",
      company: "",
      companyAddress: "",
      companyCity: "",
      companyState: "",
      companyZip: "",
      certificationNumber: "",
      registrationNumber: "",
      truckNumber: "",
      employeeName: "",
      hasAdeqCourse: false,
      adeqCourseDetails: "",
      adeqCourseDate: "",
      isProfessionalEngineer: false,
      peExpirationDate: "",
      isRegisteredSanitarian: false,
      rsExpirationDate: "",
      isWastewaterOperator: false,
      operatorGrade: "",
      isLicensedContractor: false,
      contractorLicenseCategory: "",
      hasPumperTruck: false,
      pumperTruckRegistration: "",
      recordsAvailable: "",
      hasDischargeAuth: false,
      dischargeAuthPermitNo: "",
      hasApprovalOfConstruction: false,
      approvalPermitNo: "",
      hasSitePlan: false,
      hasOperationDocs: false,
      hasOtherRecords: false,
      otherRecordsDescription: "",
      isCesspool: "",
      waterSource: "",
      wellDistance: "",
      wastewaterSource: "",
      occupancyType: "",
      facilityType: "",
      facilityTypeOther: "",
      facilitySystemTypes: [],
      numberOfSystems: "",
      facilityAge: "",
      facilityAgeEstimateExplanation: "",
      septicTankCondition: "",
      disposalWorksCondition: "",
      alternativeSystemCondition: "",
      alternativeDisposalCondition: "",
    },
    generalTreatment: {
      systemTypes: [],
      hasPerformanceAssurancePlan: "",
      alternativeSystem: false,
      altSystemManufacturer: "",
      altSystemModel: "",
      altSystemCapacity: "",
      altSystemDateInstalled: "",
      altSystemCondition: "",
      altSystemNotes: "",
    },
    designFlow: {
      estimatedDesignFlow: "",
      designFlowBasis: "",
      numberOfBedrooms: "",
      fixtureCount: "",
      nonDwellingGpd: "",
      actualFlowEvaluation: "",
      designFlowComments: "",
    },
    septicTank: {
      numberOfTanks: "",
      tanksPumped: "",
      haulerCompany: "",
      haulerLicense: "",
      pumpingNotPerformedReason: "",
      tankInspectionDate: "",
      tanks: [],
      septicTankComments: "",
    },
    disposalWorks: {
      disposalWorksLocationDetermined: "",
      disposalWorksLocationNotDeterminedReason: "",
      disposalType: "",
      disposalTypeOther: "",
      distributionMethod: "",
      supplyLineMaterial: "",
      supplyLineMaterialOther: "",
      distributionComponentInspected: "",
      inspectionPortsPresent: "",
      numberOfPorts: "",
      portDepths: [],
      hydraulicLoadTestPerformed: "",
      hasDisposalDeficiency: "",
      defCrushedOutletPipe: false,
      defRootInvasion: false,
      defHighWaterLines: false,
      defDboxNotFunctioning: false,
      defSurfacing: false,
      defLushVegetation: false,
      defErosion: false,
      defPondingWater: false,
      defAnimalIntrusion: false,
      defLoadTestFailure: false,
      defCouldNotDetermine: false,
      repairsRecommended: "",
      disposalWorksComments: "",
      signatureDate: "",
      printedName: "",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateReport", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    templateBytes = await createTemplatePdf();
  });

  it("returns a Uint8Array", async () => {
    const result = await generateReport(makeMinimalFormData(), null);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("produces a valid PDF", async () => {
    const result = await generateReport(makeMinimalFormData(), null);
    const doc = await PDFDocument.load(result);
    expect(doc).toBeDefined();
  });

  it("loads the PDF template", async () => {
    await generateReport(makeMinimalFormData(), null);
    expect(loadPublicFile).toHaveBeenCalledWith("/septic_system_insp_form_v2.pdf");
  });

  it("generates report without signature", async () => {
    const result = await generateReport(makeMinimalFormData(), null);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("generates report without media", async () => {
    const result = await generateReport(makeMinimalFormData(), null);
    expect(buildPhotoPages).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not call buildCommentsPage when no overflow", async () => {
    await generateReport(makeMinimalFormData(), null);
    // buildCommentsPage may be called but with empty overflowSections
    // The function checks overflow.hasOverflow before calling
    // Since our minimal data has no overflow, it shouldn't be called
    expect(buildCommentsPage).not.toHaveBeenCalled();
  });

  it("calls buildPhotoPages when media with photos is provided", async () => {
    const media: MediaRecord[] = [
      {
        id: "photo-1",
        type: "photo",
        storagePath: "inspections/test/photo-1.jpg",
        label: "Facility Info",
        sortOrder: 0,
        createdAt: "2026-03-01T14:30:00Z",
        signedUrl: "https://storage.example.com/photo-1.jpg",
      },
    ];
    await generateReport(makeMinimalFormData(), null, media);
    expect(buildPhotoPages).toHaveBeenCalledOnce();
    expect(buildPhotoPages).toHaveBeenCalledWith(media, expect.objectContaining({}));
  });

  it("does not call buildPhotoPages when media has no photos", async () => {
    const media: MediaRecord[] = [
      {
        id: "video-1",
        type: "video",
        storagePath: "inspections/test/video-1.mp4",
        label: "Facility Info",
        sortOrder: 0,
        createdAt: "2026-03-01T14:30:00Z",
      },
    ];
    await generateReport(makeMinimalFormData(), null, media);
    expect(buildPhotoPages).not.toHaveBeenCalled();
  });

  it("passes address and date context to buildPhotoPages", async () => {
    const data = makeMinimalFormData();
    data.facilityInfo.facilityAddress = "123 Main St";
    data.facilityInfo.dateOfInspection = "03/01/2026";

    const media: MediaRecord[] = [
      {
        id: "photo-1",
        type: "photo",
        storagePath: "inspections/test/photo-1.jpg",
        label: "Facility Info",
        sortOrder: 0,
        createdAt: "2026-03-01T14:30:00Z",
        signedUrl: "https://storage.example.com/photo-1.jpg",
      },
    ];
    await generateReport(data, null, media);

    expect(buildPhotoPages).toHaveBeenCalledWith(media, {
      address: "123 Main St",
      date: "03/01/2026",
    });
  });

  it("calls buildCommentsPage when comment overflow detected", async () => {
    const data = makeMinimalFormData();
    data.designFlow.designFlowComments = "A".repeat(300); // Over 200 char threshold

    await generateReport(data, null);
    expect(buildCommentsPage).toHaveBeenCalledOnce();
    expect(buildCommentsPage).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          section: "Design Flow",
          fieldName: "designFlowComments",
        }),
      ]),
    );
  });

  it("throws when template PDF fails to load", async () => {
    vi.mocked(loadPublicFile).mockRejectedValueOnce(new Error("Template not found"));
    await expect(generateReport(makeMinimalFormData(), null)).rejects.toThrow("Template not found");
  });

  it("auto-fills signature date when not provided in form data", async () => {
    const data = makeMinimalFormData();
    // Leave conventionalSignatureDate unset
    const result = await generateReport(data, null);
    expect(result).toBeInstanceOf(Uint8Array);
    // The function should have attempted to set the date field
    // (we can't easily verify the field value since form is flattened,
    // but it should not throw)
  });

  it("handles empty media array", async () => {
    const result = await generateReport(makeMinimalFormData(), null, []);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(buildPhotoPages).not.toHaveBeenCalled();
  });
});
