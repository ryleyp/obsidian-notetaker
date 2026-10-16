import { describe, expect, it } from "vitest";
import { extractLocalNerEntities } from "./localNer";

describe("local named-entity recognition", () => {
  it("finds people, organizations, and places without a network service", () => {
    const entities = extractLocalNerEntities("Mary met Dr. John Smith from Google Inc in Paris.");
    expect(entities).toEqual(expect.arrayContaining([
      { text: "Mary", type: "person" },
      { text: "Dr. John Smith", type: "person" },
      { text: "Google Inc", type: "org" },
      { text: "Paris", type: "location" },
    ]));
  });

  it("does not classify supported public product names as private entities", () => {
    expect(extractLocalNerEntities("NI demonstrated LabVIEW and SystemLink.")).toEqual([]);
  });
});
