import { describe, it, expect } from "vitest";
import { loginSchema, createUserSchema } from "../auth";

// ============================================================================
// loginSchema
// ============================================================================

describe("loginSchema", () => {
  it("accepts valid login data", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
      expect(result.data.password).toBe("secret123");
    }
  });

  describe("email field", () => {
    it("rejects missing email", () => {
      const result = loginSchema.safeParse({ password: "secret123" });
      expect(result.success).toBe(false);
    });

    it("rejects empty email", () => {
      const result = loginSchema.safeParse({ email: "", password: "secret123" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid email format", () => {
      const result = loginSchema.safeParse({
        email: "not-an-email",
        password: "secret123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects email without domain", () => {
      const result = loginSchema.safeParse({
        email: "user@",
        password: "secret123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects email without @ symbol", () => {
      const result = loginSchema.safeParse({
        email: "user.example.com",
        password: "secret123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("password field", () => {
    it("rejects missing password", () => {
      const result = loginSchema.safeParse({ email: "user@example.com" });
      expect(result.success).toBe(false);
    });

    it("rejects empty password", () => {
      const result = loginSchema.safeParse({
        email: "user@example.com",
        password: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts single character password (min length 1)", () => {
      const result = loginSchema.safeParse({
        email: "user@example.com",
        password: "x",
      });
      expect(result.success).toBe(true);
    });
  });

  it("strips extra fields", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "secret123",
      extraField: "should be ignored",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// createUserSchema
// ============================================================================

describe("createUserSchema", () => {
  const validData = {
    email: "newuser@example.com",
    password: "password123",
    fullName: "John Doe",
    role: "admin" as const,
  };

  it("accepts valid user creation data", () => {
    const result = createUserSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validData);
    }
  });

  it("accepts all valid roles", () => {
    for (const role of ["admin", "field_tech", "office_staff"] as const) {
      const result = createUserSchema.safeParse({ ...validData, role });
      expect(result.success).toBe(true);
    }
  });

  describe("email field", () => {
    it("rejects missing email", () => {
      const { email, ...rest } = validData;
      const result = createUserSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid email", () => {
      const result = createUserSchema.safeParse({ ...validData, email: "bad" });
      expect(result.success).toBe(false);
    });
  });

  describe("password field", () => {
    it("rejects missing password", () => {
      const { password, ...rest } = validData;
      const result = createUserSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects password shorter than 8 characters", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        password: "short",
      });
      expect(result.success).toBe(false);
    });

    it("accepts password with exactly 8 characters", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        password: "12345678",
      });
      expect(result.success).toBe(true);
    });

    it("accepts long password", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        password: "a".repeat(100),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("fullName field", () => {
    it("rejects missing fullName", () => {
      const { fullName, ...rest } = validData;
      const result = createUserSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects empty fullName", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        fullName: "",
      });
      expect(result.success).toBe(false);
    });

    it("accepts single character name", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        fullName: "A",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("role field", () => {
    it("rejects missing role", () => {
      const { role, ...rest } = validData;
      const result = createUserSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid role", () => {
      const result = createUserSchema.safeParse({
        ...validData,
        role: "superadmin",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty string role", () => {
      const result = createUserSchema.safeParse({ ...validData, role: "" });
      expect(result.success).toBe(false);
    });

    it("rejects numeric role", () => {
      const result = createUserSchema.safeParse({ ...validData, role: 123 });
      expect(result.success).toBe(false);
    });
  });
});
