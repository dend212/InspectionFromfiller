import { describe, it, expect } from "vitest";
import { workizWebhookSchema } from "../workiz-webhook";

describe("workizWebhookSchema", () => {
  const validPayload = {
    client: {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "555-1234",
    },
    address: {
      street: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      county: "Maricopa",
    },
    job: {
      jobId: "JOB-001",
      jobType: "inspection",
      serviceType: "septic",
      scheduledDate: "2026-03-03",
    },
    tech: {
      email: "tech@example.com",
      name: "Tech Person",
    },
  };

  it("accepts a fully valid payload", () => {
    const result = workizWebhookSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.client.firstName).toBe("John");
      expect(result.data.client.lastName).toBe("Doe");
      expect(result.data.address.street).toBe("123 Main St");
      expect(result.data.tech.email).toBe("tech@example.com");
    }
  });

  // ===========================================================================
  // client object
  // ===========================================================================

  describe("client", () => {
    it("rejects missing client", () => {
      const { client, ...rest } = validPayload;
      const result = workizWebhookSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing firstName", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { lastName: "Doe" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty firstName", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { ...validPayload.client, firstName: "" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing lastName", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { firstName: "John" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty lastName", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { ...validPayload.client, lastName: "" },
      });
      expect(result.success).toBe(false);
    });

    it("email defaults to empty string when omitted", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { firstName: "John", lastName: "Doe" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.client.email).toBe("");
        expect(result.data.client.phone).toBe("");
      }
    });

    it("accepts client with only required fields", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        client: { firstName: "A", lastName: "B" },
      });
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // address object
  // ===========================================================================

  describe("address", () => {
    it("rejects missing address", () => {
      const { address, ...rest } = validPayload;
      const result = workizWebhookSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing street", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        address: { city: "Phoenix" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty street", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        address: { ...validPayload.address, street: "" },
      });
      expect(result.success).toBe(false);
    });

    it("defaults optional address fields", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        address: { street: "123 Main St" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.address.city).toBe("");
        expect(result.data.address.state).toBe("AZ");
        expect(result.data.address.zip).toBe("");
        expect(result.data.address.county).toBe("");
      }
    });

    it("state defaults to AZ", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        address: { street: "123 Main St" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.address.state).toBe("AZ");
      }
    });
  });

  // ===========================================================================
  // job object
  // ===========================================================================

  describe("job", () => {
    it("defaults job when omitted", () => {
      const { job, ...rest } = validPayload;
      const result = workizWebhookSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.job).toEqual({
          jobId: "",
          jobType: "",
          serviceType: "",
          scheduledDate: "",
        });
      }
    });

    it("defaults individual job fields when empty object given", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        job: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.job.jobId).toBe("");
        expect(result.data.job.jobType).toBe("");
        expect(result.data.job.serviceType).toBe("");
        expect(result.data.job.scheduledDate).toBe("");
      }
    });

    it("accepts partial job object", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        job: { jobId: "JOB-999" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.job.jobId).toBe("JOB-999");
        expect(result.data.job.jobType).toBe("");
      }
    });
  });

  // ===========================================================================
  // tech object (with refinement)
  // ===========================================================================

  describe("tech", () => {
    it("rejects missing tech", () => {
      const { tech, ...rest } = validPayload;
      const result = workizWebhookSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("accepts tech with only email", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: { email: "tech@example.com" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tech.email).toBe("tech@example.com");
        expect(result.data.tech.name).toBe("");
      }
    });

    it("accepts tech with only name", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: { name: "John Tech" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tech.name).toBe("John Tech");
        expect(result.data.tech.email).toBe("");
      }
    });

    it("accepts tech with both email and name", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: { email: "tech@example.com", name: "John Tech" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects tech with neither email nor name (refinement)", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects tech with empty email and empty name (refinement)", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: { email: "", name: "" },
      });
      expect(result.success).toBe(false);
    });

    it("refinement error message is correct", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        tech: { email: "", name: "" },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain(
          "Either tech email or tech name is required for assignment",
        );
      }
    });
  });

  // ===========================================================================
  // apn field
  // ===========================================================================

  describe("apn", () => {
    it("defaults to empty string when omitted", () => {
      const result = workizWebhookSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apn).toBe("");
      }
    });

    it("accepts a provided APN value", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        apn: "123-45-678A",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apn).toBe("123-45-678A");
      }
    });
  });

  // ===========================================================================
  // assessor object (optional)
  // ===========================================================================

  describe("assessor", () => {
    it("is undefined when omitted", () => {
      const result = workizWebhookSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assessor).toBeUndefined();
      }
    });

    it("accepts full assessor data", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        assessor: {
          ownerName: "Property Owner",
          physicalAddress: "123 Main St",
          city: "Phoenix",
          zip: "85001",
          county: "Maricopa",
          mailingAddress: "PO Box 100",
          legalDescription: "Lot 1 Block 2",
          lotSize: "0.5 acres",
          yearBuilt: "1985",
          apnFormatted: "123-45-678A",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assessor?.ownerName).toBe("Property Owner");
        expect(result.data.assessor?.yearBuilt).toBe("1985");
      }
    });

    it("defaults assessor sub-fields to empty strings", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        assessor: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assessor?.ownerName).toBe("");
        expect(result.data.assessor?.physicalAddress).toBe("");
        expect(result.data.assessor?.city).toBe("");
        expect(result.data.assessor?.zip).toBe("");
        expect(result.data.assessor?.county).toBe("");
        expect(result.data.assessor?.mailingAddress).toBe("");
        expect(result.data.assessor?.legalDescription).toBe("");
        expect(result.data.assessor?.lotSize).toBe("");
        expect(result.data.assessor?.yearBuilt).toBe("");
        expect(result.data.assessor?.apnFormatted).toBe("");
      }
    });

    it("accepts partial assessor data", () => {
      const result = workizWebhookSchema.safeParse({
        ...validPayload,
        assessor: { ownerName: "Jane" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assessor?.ownerName).toBe("Jane");
        expect(result.data.assessor?.city).toBe("");
      }
    });
  });

  // ===========================================================================
  // edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("rejects completely empty object", () => {
      const result = workizWebhookSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = workizWebhookSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("rejects undefined", () => {
      const result = workizWebhookSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it("rejects non-object", () => {
      const result = workizWebhookSchema.safeParse("string");
      expect(result.success).toBe(false);
    });

    it("rejects array", () => {
      const result = workizWebhookSchema.safeParse([validPayload]);
      expect(result.success).toBe(false);
    });
  });
});
