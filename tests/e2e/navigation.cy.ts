/// <reference types="cypress" />

describe('Navigation', () => {
  describe('Desktop Navigation', () => {
    beforeEach(() => {
      cy.viewport(1280, 720);
      cy.visit('/');
    });

    it('displays the header with logo and branding', () => {
      cy.get('#site-nav').should('be.visible');
      cy.get('#site-nav img[alt="Stamm Phoenix Lilie"]').should('be.visible');
      cy.contains('DPSG').should('be.visible');
      cy.contains('Stamm Phoenix').should('be.visible');
      cy.contains('Feldkirchen-Westerham').should('be.visible');
    });

    it('shows all navigation links on desktop', () => {
      cy.get('nav[aria-label="Hauptnavigation"]').within(() => {
        cy.contains('Start').should('be.visible');
        cy.contains('Gruppenstunden').should('be.visible');
        cy.contains('Aktionen').should('be.visible');
        cy.contains('Downloads').should('be.visible');
        cy.contains('Vorstand').should('be.visible');
        cy.contains('Kontakt').should('be.visible');
      });
    });

    it('highlights current page in navigation', () => {
      cy.get('nav[aria-label="Hauptnavigation"] a[href="/"]').should(
        'have.attr',
        'aria-current',
        'page'
      );

      cy.visit('/gruppenstunden');
      cy.get('nav[aria-label="Hauptnavigation"] a[href="/gruppenstunden"]').should(
        'have.attr',
        'aria-current',
        'page'
      );

      cy.visit('/vorstand');
      cy.get('nav[aria-label="Hauptnavigation"] a[href="/vorstand"]').should(
        'have.attr',
        'aria-current',
        'page'
      );
    });

    it('navigates to all main pages', () => {
      cy.get('nav[aria-label="Hauptnavigation"]').contains('Gruppenstunden').click();
      cy.url().should('include', '/gruppenstunden');
      cy.get('h1').should('contain', 'Gruppenstunden');

      cy.get('nav[aria-label="Hauptnavigation"]').contains('Aktionen').click();
      cy.url().should('include', '/aktionen');
      cy.get('h1').should('contain', 'Kalender');

      cy.get('nav[aria-label="Hauptnavigation"]').contains('Downloads').click();
      cy.url().should('include', '/downloads');
      cy.get('h1').should('contain', 'Downloads');

      cy.get('nav[aria-label="Hauptnavigation"]').contains('Vorstand').click();
      cy.url().should('include', '/vorstand');
      cy.get('h1').should('contain', 'Vorstand');

      cy.get('nav[aria-label="Hauptnavigation"]').contains('Kontakt').click();
      cy.url().should('include', '/kontakt');
      cy.get('h1').should('contain', 'Meld dich bei uns');

      cy.get('nav[aria-label="Hauptnavigation"]').contains('Start').click();
      cy.url().should('eq', Cypress.config().baseUrl + '/');
    });

    it('displays Mitmachen CTA button', () => {
      cy.get('header').contains('Mitmachen').should('be.visible');
      cy.get('header').contains('Mitmachen').click();
      cy.url().should('include', '/mitmachen');
    });

    it('hides mobile menu button on desktop', () => {
      cy.get('#menu-btn').should('not.be.visible');
    });
  });

  describe('Mobile Navigation', () => {
    beforeEach(() => {
      cy.viewport(375, 667);
      cy.visit('/');
    });

    it('displays hamburger menu button on mobile', () => {
      cy.get('#menu-btn').should('be.visible');
    });

    it('hides desktop navigation on mobile', () => {
      cy.get('nav[aria-label="Hauptnavigation"]').should('not.be.visible');
    });

    it('opens mobile menu when hamburger is clicked', () => {
      cy.get('#mobile-menu').should('have.class', 'hidden');
      cy.get('#menu-btn').should('have.attr', 'aria-expanded', 'false');

      cy.get('#menu-btn').click();

      cy.get('#mobile-menu').should('not.have.class', 'hidden');
      cy.get('#menu-btn').should('have.attr', 'aria-expanded', 'true');
    });

    it('closes mobile menu when clicking a link', () => {
      cy.get('#menu-btn').click();
      cy.get('#mobile-menu').should('not.have.class', 'hidden');

      cy.get('#mobile-menu').contains('Gruppenstunden').click();
      cy.url().should('include', '/gruppenstunden');
    });

    it('shows all navigation links in mobile menu', () => {
      cy.get('#menu-btn').click();
      cy.get('#mobile-menu').within(() => {
        cy.contains('Start').should('be.visible');
        cy.contains('Gruppenstunden').should('be.visible');
        cy.contains('Aktionen').should('be.visible');
        cy.contains('Downloads').should('be.visible');
        cy.contains('Vorstand').should('be.visible');
        cy.contains('Kontakt').should('be.visible');
      });
    });

    it('closes menu when clicking outside', () => {
      cy.get('#menu-btn').click();
      cy.get('#mobile-menu').should('not.have.class', 'hidden');

      cy.get('body').click(0, 0);
      cy.get('#mobile-menu').should('have.class', 'hidden');
    });

    it('closes menu on Escape key', () => {
      cy.get('#menu-btn').click();
      cy.get('#mobile-menu').should('not.have.class', 'hidden');

      cy.get('body').type('{esc}');
      cy.get('#mobile-menu').should('have.class', 'hidden');
    });
  });

  describe('Footer Navigation', () => {
    beforeEach(() => {
      cy.visit('/');
    });

    it('displays footer with branding', () => {
      cy.get('footer').within(() => {
        cy.contains('DPSG').should('be.visible');
        cy.contains('Stamm Phoenix').should('be.visible');
      });
    });

    it('contains navigation links', () => {
      cy.get('footer').within(() => {
        cy.contains('Start').should('have.attr', 'href', '/');
        cy.contains('Gruppenstunden').should('have.attr', 'href', '/gruppenstunden');
        cy.contains('Vorstand').should('have.attr', 'href', '/vorstand');
        cy.contains('Kontakt').should('have.attr', 'href', '/kontakt');
      });
    });

    it('contains contact information', () => {
      cy.get('footer').within(() => {
        cy.contains('Feldkirchen-Westerham').should('be.visible');
        cy.contains('kontakt@stamm-phoenix.de').should(
          'have.attr',
          'href',
          'mailto:kontakt@stamm-phoenix.de'
        );
      });
    });

    it('links to impressum', () => {
      cy.get('footer').contains('Impressum').should('have.attr', 'href', '/impressum');
    });

    it('displays copyright notice', () => {
      const currentYear = new Date().getFullYear();
      cy.get('footer').contains(`© ${currentYear} DPSG Stamm Phoenix`).should('be.visible');
    });
  });
});
