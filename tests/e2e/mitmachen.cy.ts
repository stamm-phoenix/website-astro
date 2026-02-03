/// <reference types="cypress" />

describe('Mitmachen Page', () => {
  beforeEach(() => {
    cy.visit('/mitmachen');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Mitmachen');
    cy.get('h1').should('contain', 'Mitmachen');
  });

  it('displays page description', () => {
    cy.contains('Du möchtest bei uns mitmachen?').should('be.visible');
  });

  describe('Schnupperstunde CTA', () => {
    it('displays prominent Schnupperstunde section', () => {
      cy.contains('Erst mal reinschnuppern?').should('be.visible');
    });

    it('shows email CTA button', () => {
      cy.contains('a', 'E-Mail schreiben')
        .should('have.attr', 'href')
        .and('include', 'mailto:kontakt@stamm-phoenix.de')
        .and('include', 'Schnupperstunde');
    });

    it('mentions Schnupperstunde in text', () => {
      cy.contains('Schnupperstunde').should('be.visible');
    });
  });

  describe('Membership Paths', () => {
    it('displays member path card', () => {
      cy.contains('h2', 'Als Mitglied').should('be.visible');
      cy.contains('7 bis 18 Jahren').should('be.visible');
    });

    it('displays leader path card', () => {
      cy.contains('h2', 'Als Gruppenleiter').should('be.visible');
    });

    it('mentions option for older scouts to become leaders', () => {
      cy.contains('Zu alt für die Rover?').should('be.visible');
    });

    it('mentions Leitendenrunde', () => {
      cy.contains('Leitendenrunde').should('be.visible');
    });

    it('provides contact for leader inquiries', () => {
      cy.contains('kontakt@stamm-phoenix.de').should('be.visible');
    });

    it('links to Gruppenstunden page', () => {
      cy.contains('a', 'Gruppenstunden').should('have.attr', 'href', '/gruppenstunden');
    });
  });

  describe('Mitgliedsantrag Form', () => {
    it('displays Mitgliedsantrag heading', () => {
      cy.contains('h2', 'Mitgliedsantrag').should('be.visible');
    });

    it('displays noscript message for users without JavaScript', () => {
      cy.get('noscript').should('contain', 'Bitte JavaScript aktivieren');
    });

    it('contains Campflow embed script', () => {
      cy.get('script[src="https://embed.campflow.de"]').should('exist');
      cy.get('script[data-slug="dpsg-stamm-phoenix-5629/mitgliedsantrag"]').should('exist');
    });
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
      cy.contains('Gruppenstunden').first().click();
      cy.url().should('include', '/gruppenstunden');
    });
  });
});
