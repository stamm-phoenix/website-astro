/// <reference types="cypress" />

describe('Vorstand Page', () => {
  beforeEach(() => {
    cy.visit('/vorstand');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Vorstand');
    cy.get('h1').should('contain', 'Vorstand');
  });

  it('displays page description', () => {
    cy.contains('Der Stammesvorstand vertritt unseren Stamm').should('be.visible');
  });

  describe('Stammesvorstände Section', () => {
    it('displays Stammesvorstände heading', () => {
      cy.contains('h2', 'Stammesvorstände').should('be.visible');
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
  });

  describe('Aufgaben Section', () => {
    it('displays Aufgaben heading', () => {
      cy.contains('h2', 'Aufgaben des Vorstands').should('be.visible');
    });

    it('lists Vorstand responsibilities', () => {
      cy.contains('Vertretung des Stammes nach außen').should('be.visible');
      cy.contains('Koordination der Stammesarbeit').should('be.visible');
      cy.contains('Ansprechpartner für Eltern').should('be.visible');
    });
  });

  describe('Navigation', () => {
    it('is accessible from header navigation', () => {
      cy.get('nav[aria-label="Hauptnavigation"]').contains('Vorstand').should('be.visible');
    });

    it('shows as current page in navigation', () => {
      cy.get('nav[aria-label="Hauptnavigation"] a[href="/vorstand"]')
        .should('have.attr', 'aria-current', 'page');
    });
  });

  describe('Responsive Layout', () => {
    it('displays contact cards properly on desktop', () => {
      cy.viewport(1280, 720);
      cy.contains('Simon Lamminger').should('be.visible');
      cy.contains('Johannes Schmalstieg').should('be.visible');
    });

    it('displays contact cards on mobile', () => {
      cy.viewport(375, 667);
      cy.contains('Simon Lamminger').should('be.visible');
      cy.contains('Johannes Schmalstieg').should('be.visible');
    });
  });
});
