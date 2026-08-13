import { normalizeAccountType } from "./accountTypes";

describe("normalizeAccountType", () => {
  it("keeps supported web account types", () => {
    expect(normalizeAccountType("Admin")).toBe("Admin");
    expect(normalizeAccountType("Company")).toBe("Company");
    expect(normalizeAccountType("Client")).toBe("Client");
  });

  it("maps legacy mobile company-user values to Company", () => {
    expect(normalizeAccountType("Technician")).toBe("Company");
    expect(normalizeAccountType("tech")).toBe("Company");
  });

  it("returns null for missing or unknown values", () => {
    expect(normalizeAccountType("")).toBeNull();
    expect(normalizeAccountType("Free")).toBeNull();
  });
});
