/// <reference types="cypress" />

describe('Kontakt Page', () => {
  beforeEach(() => {
    cy.visit('/kontakt');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Kontakt');
    cy.get('h1').should('contain', 'Meld dich bei uns');
  });

  it('displays page description', () => {
    cy.contains('Egal ob Fragen zu Gruppenstunden, Aktionen oder zur Mitgliedschaft').should('be.visible');
  });

  describe('Email Contact', () => {
    it('displays email section', () => {
      cy.contains('E-Mail').should('be.visible');
    });

    it('shows email address with mailto link', () => {
      cy.contains('a', 'kontakt@stamm-phoenix.de')
        .should('have.attr', 'href', 'mailto:kontakt@stamm-phoenix.de');
    });
  });

  describe('Vorstand Contact Information', () => {
    it('displays Vorstand section', () => {
      cy.contains('Vorstand').should('be.visible');
    });

    it('shows Simon Lamminger contact details', () => {
      cy.contains('Simon Lamminger').should('be.visible');
      cy.contains('+49 175 7539860').should('be.visible');
      cy.contains('Ölbergring 10B').should('be.visible');
      cy.contains('83620 Feldkirchen-Westerham').should('be.visible');
    });

    it('shows Johannes Schmalstieg contact details', () => {
      cy.contains('Johannes Schmalstieg').should('be.visible');
      cy.contains('+49 177 2687874').should('be.visible');
      cy.contains('Spitzingstrasse 18').should('be.visible');
    });

    it('displays phone numbers', () => {
      // Phone numbers are displayed as text, not links
      cy.contains('+49 175 7539860').should('be.visible');
      cy.contains('+49 177 2687874').should('be.visible');
    });
  });

  describe('Responsive Layout', () => {
    it('displays cards properly on desktop', () => {
      cy.viewport(1280, 720);
      cy.contains('E-Mail').should('be.visible');
      cy.contains('Vorstand').should('be.visible');
    });

    it('displays cards stacked on mobile', () => {
      cy.viewport(375, 667);
      cy.contains('E-Mail').should('be.visible');
      cy.contains('Vorstand').should('be.visible');
    });
  });
});
