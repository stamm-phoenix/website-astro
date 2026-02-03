/// <reference types="cypress" />

describe('Mitmachen Page', () => {
  beforeEach(() => {
    cy.visit('/mitmachen');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Mitmachen');
    cy.get('h1').should('contain', 'Mitmachen');
  });

  it('displays page description about Mitgliedsantrag', () => {
    cy.contains('Fülle den Mitgliedsantrag online aus').should('be.visible');
    cy.contains('Campflow').should('be.visible');
  });

  it('displays noscript message for users without JavaScript', () => {
    cy.get('noscript').should('contain', 'Bitte JavaScript aktivieren');
  });

  it('contains Campflow embed script', () => {
    cy.get('script[src="https://embed.campflow.de"]').should('exist');
    cy.get('script[data-slug="dpsg-stamm-phoenix-5629/mitgliedsantrag"]').should('exist');
  });

  it('has header and footer', () => {
    cy.get('#site-nav').should('be.visible');
    cy.get('footer').should('be.visible');
  });

  describe('Navigation from Mitmachen', () => {
    it('can navigate back to homepage', () => {
      cy.contains('Start').click();
      cy.url().should('eq', Cypress.config().baseUrl + '/');
    });

    it('can navigate to Gruppenstunden', () => {
      cy.contains('Gruppenstunden').click();
      cy.url().should('include', '/gruppenstunden');
    });
  });
});
