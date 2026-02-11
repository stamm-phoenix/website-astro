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
    cy.contains('Egal ob Fragen zu Gruppenstunden, Aktionen oder zur Mitgliedschaft').should(
      'be.visible'
    );
  });

  describe('Email Contact', () => {
    it('displays email section', () => {
      cy.contains('E-Mail').should('be.visible');
    });

    it('shows email address with mailto link', () => {
      cy.contains('a', 'kontakt@stamm-phoenix.de').should(
        'have.attr',
        'href',
        'mailto:kontakt@stamm-phoenix.de'
      );
    });

    it('describes what the email is for', () => {
      cy.contains('Fragen zu Gruppenstunden, Schnupperstunden').should('be.visible');
    });
  });

  describe('Vorstand Section', () => {
    it('displays Vorstand section', () => {
      // Scope to main content to avoid matching nav links
      cy.get('main').contains('h2', 'Vorstand').should('be.visible');
    });

    it('links to Vorstand page', () => {
      cy.contains('a', 'Stammesvorstand').should('have.attr', 'href', '/vorstand');
    });

    it('has button to navigate to Vorstand page', () => {
      cy.contains('a', 'Zum Vorstand').should('have.attr', 'href', '/vorstand');
    });

    it('navigates to Vorstand page when clicked', () => {
      cy.contains('a', 'Zum Vorstand').click();
      cy.url().should('include', '/vorstand');
    });
  });

  describe('Responsive Layout', () => {
    it('displays cards properly on desktop', () => {
      cy.viewport(1280, 720);
      // Scope to main content to avoid matching hidden nav links
      cy.get('main').within(() => {
        cy.contains('E-Mail').should('be.visible');
        cy.contains('h2', 'Vorstand').should('be.visible');
      });
    });

    it('displays cards stacked on mobile', () => {
      cy.viewport(375, 667);
      // Scope to main content to avoid matching hidden nav links
      cy.get('main').within(() => {
        cy.contains('E-Mail').should('be.visible');
        cy.contains('h2', 'Vorstand').should('be.visible');
      });
    });
  });
});
