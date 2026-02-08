/// <reference types="cypress" />

describe("Impressum Page", () => {
  beforeEach(() => {
    cy.visit("/impressum");
  });

  it("loads successfully with correct title", () => {
    cy.title().should("include", "Impressum");
    cy.get("h1").should("contain", "Impressum");
  });

  describe("Legal Information Sections", () => {
    it("displays legal notice section according to DDG", () => {
      cy.contains("Angaben gemäß § 5 DDG").should("be.visible");
      cy.contains("Deutsche Pfadfinderschaft Sankt Georg").should("be.visible");
      cy.contains("Stamm Phoenix Feldkirchen-Westerham").should("be.visible");
    });

    it("displays board section with contact details", () => {
      cy.get("main").contains("h2", "Vertreten durch den Stammesvorstand").should("be.visible");
      cy.get("main").contains("Simon Lamminger").should("be.visible");
      cy.get("main").contains("Johannes Schmalstieg").should("be.visible");
      cy.get("main").contains("+49 175 7539860").should("be.visible");
      cy.get("main").contains("+49 177 2687874").should("be.visible");
    });

    it("displays contact section", () => {
      cy.contains("Kontakt").should("be.visible");
      cy.contains("kontakt@stamm-phoenix.de").should("be.visible");
    });

    it("displays content responsibility section according to MStV", () => {
      cy.contains("Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV").should("be.visible");
      cy.contains("Simon Lamminger").should("be.visible");
    });

    it("displays Verfasser section", () => {
      cy.contains("Verfasser").should("be.visible");
      cy.contains("Design und Layout").should("be.visible");
      cy.contains("Hugo Berendo").should("be.visible");
    });

    it("displays liability disclaimer section", () => {
      cy.contains("Haftungsausschluss").should("be.visible");
      cy.contains("Haftung für Inhalte").should("be.visible");
      cy.contains("Haftung für Links").should("be.visible");
    });

    it("displays Verbandszugehörigkeit section with DPSG logo", () => {
      cy.contains("Verbandszugehörigkeit").should("be.visible");
      cy.contains("Bayerischen Jugendring").should("be.visible");
      cy.contains("BDKJ").should("be.visible");
      cy.contains("WOSM").should("be.visible");
      cy.get('img[alt="DPSG Logo"]').should("be.visible");
    });
  });

  describe("Responsive Layout", () => {
    it("displays content properly on desktop", () => {
      cy.viewport(1280, 720);
      cy.contains("Angaben gemäß § 5 DDG").should("be.visible");
      cy.contains("Verbandszugehörigkeit").should("be.visible");
    });

    it("displays content properly on mobile", () => {
      cy.viewport(375, 667);
      cy.contains("Angaben gemäß § 5 DDG").should("be.visible");
      cy.contains("Verbandszugehörigkeit").should("be.visible");
    });
  });

  it("is accessible from footer", () => {
    cy.visit("/");
    cy.get("footer").contains("Impressum").click();
    cy.url().should("include", "/impressum");
    cy.get("h1").should("contain", "Impressum");
  });
});
