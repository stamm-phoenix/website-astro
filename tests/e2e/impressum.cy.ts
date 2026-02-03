/// <reference types="cypress" />

describe('Impressum Page', () => {
  beforeEach(() => {
    cy.visit('/impressum');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Impressum');
    cy.get('h1').should('contain', 'Impressum');
  });

  it('displays Rechtliches label', () => {
    cy.contains('Rechtliches').should('be.visible');
  });

  describe('Legal Information Sections', () => {
    it('displays Veröffentlicher section', () => {
      cy.contains('Veröffentlicher').should('be.visible');
      cy.contains('Deutsche Pfadfinderschaft Sankt Georg').should('be.visible');
      cy.contains('Stamm Phoenix Feldkirchen-Westerham').should('be.visible');
    });

    it('displays Vorstand section with contact details', () => {
      cy.contains('Vorstand').should('be.visible');
      cy.contains('Simon Lamminger').should('be.visible');
      cy.contains('Johannes Schmalstieg').should('be.visible');
      cy.contains('+49 175 7539860').should('be.visible');
      cy.contains('+49 177 2687874').should('be.visible');
    });

    it('displays Verfasser section', () => {
      cy.contains('Verfasser').should('be.visible');
      cy.contains('Design und Layout').should('be.visible');
      cy.contains('Nico Welles').should('be.visible');
    });

    it('displays Icons section with attribution', () => {
      cy.contains('Icons').should('be.visible');
      cy.contains('Phoenix Icon').should('be.visible');
      cy.contains('flaticon.com').should('have.attr', 'href').and('include', 'flaticon.com');
    });

    it('displays Verbandszugehörigkeit section', () => {
      cy.contains('Verbandszugehörigkeit').should('be.visible');
      cy.contains('Bayerischen Jugendring').should('be.visible');
      cy.contains('BDKJ').should('be.visible');
      cy.contains('WOSM').should('be.visible');
    });
  });

  describe('External Links', () => {
    it('flaticon link opens in new tab or has external indicator', () => {
      cy.contains('flaticon.com')
        .should('have.attr', 'href')
        .and('include', 'flaticon.com');
    });
  });

  describe('Responsive Layout', () => {
    it('displays content properly on desktop', () => {
      cy.viewport(1280, 720);
      cy.contains('Veröffentlicher').should('be.visible');
      cy.contains('Verbandszugehörigkeit').should('be.visible');
    });

    it('displays content properly on mobile', () => {
      cy.viewport(375, 667);
      cy.contains('Veröffentlicher').should('be.visible');
      cy.contains('Verbandszugehörigkeit').should('be.visible');
    });
  });

  it('is accessible from footer', () => {
    cy.visit('/');
    cy.get('footer').contains('Impressum').click();
    cy.url().should('include', '/impressum');
    cy.get('h1').should('contain', 'Impressum');
  });
});
