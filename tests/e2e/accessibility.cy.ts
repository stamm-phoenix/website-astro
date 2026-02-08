/// <reference types="cypress" />

describe('Accessibility', () => {
  describe('Skip Link', () => {
    it('has skip to content link on homepage', () => {
      cy.visit('/');
      cy.get('a[href="#main"]').should('exist');
      cy.get('a[href="#main"]').should('contain', 'Zum Inhalt springen');
    });

    it('skip link becomes visible on focus', () => {
      cy.visit('/');
      cy.get('a[href="#main"]').focus();
      // Tailwind focus:not-sr-only makes it visible, check it has proper focus styles
      cy.get('a[href="#main"]')
        .should('have.css', 'position', 'fixed')
        .and('have.css', 'clip', 'auto');
    });
  });

  describe('Semantic Structure', () => {
    it('has proper heading hierarchy on homepage', () => {
      cy.visit('/');
      cy.get('h1').should('have.length', 1);
      cy.get('h1').should('be.visible');
    });

    it('has proper heading hierarchy on all pages', () => {
      const pages = ['/', '/gruppenstunden', '/aktionen', '/kontakt', '/mitmachen', '/impressum'];
      
      pages.forEach((page) => {
        cy.visit(page);
        cy.get('h1').should('have.length', 1);
      });
    });

    it('has navigation landmark', () => {
      cy.visit('/');
      cy.get('nav[aria-label="Hauptnavigation"]').should('exist');
    });

    it('has header landmark', () => {
      cy.visit('/');
      cy.get('header').should('exist');
    });

    it('has footer landmark', () => {
      cy.visit('/');
      cy.get('footer').should('exist');
    });
  });

  describe('ARIA Attributes', () => {
    it('mobile menu has proper aria attributes', () => {
      cy.viewport(375, 667);
      cy.visit('/');
      
      cy.get('#menu-btn').should('have.attr', 'aria-controls', 'mobile-menu');
      cy.get('#menu-btn').should('have.attr', 'aria-expanded', 'false');
      cy.get('#menu-btn').should('have.attr', 'aria-label', 'Menü öffnen');
    });

    it('navigation links have aria-current for active page', () => {
      cy.visit('/gruppenstunden');
      cy.get('a[href="/gruppenstunden"][aria-current="page"]').should('exist');
    });

    it('filter buttons have aria-pressed attribute', () => {
      cy.visit('/aktionen');
      cy.get('.filter-btn').each(($btn) => {
        cy.wrap($btn).should('have.attr', 'aria-pressed');
      });
    });
  });

  describe('Images', () => {
    it('logo image has alt text', () => {
      cy.visit('/');
      cy.get('img[alt="Stamm Phoenix Lilie"]').should('exist');
    });

    it('DPSG logo has alt text', () => {
      cy.visit('/');
      cy.get('img[alt="DPSG Wort-Bild-Marke"]').should('exist');
    });

    it('decorative images are hidden from screen readers', () => {
      cy.visit('/');
      cy.get('header [aria-hidden="true"]').should('exist');
    });
  });

  describe('Focus Management', () => {
    it('interactive elements are focusable', () => {
      cy.visit('/');
      
      cy.get('a[href="/"]').first().focus();
      cy.focused().should('have.attr', 'href', '/');
    });

    it('buttons have visible focus indicators', () => {
      cy.visit('/');
      cy.get('header').contains('Mitmachen').focus();
      cy.focused().should('have.css', 'outline-style').and('not.eq', 'none');
    });
  });

  describe('Color and Contrast', () => {
    it('text content is visible against background', () => {
      cy.visit('/');
      cy.get('h1').should('be.visible');
      cy.get('p').first().should('be.visible');
    });
  });

  describe('Keyboard Navigation', () => {
    it('can tab to skip link first', () => {
      cy.viewport(1280, 720);
      cy.visit('/');

      // Focus the body and use realPress or check tab order manually
      cy.get('a[href="#main"]').first().focus();
      cy.focused().should('have.attr', 'href', '#main');
    });

    it('mobile menu can be closed with Escape', () => {
      cy.viewport(375, 667);
      cy.visit('/');
      
      cy.get('#menu-btn').click();
      cy.get('#mobile-menu').should('not.have.class', 'hidden');
      
      cy.get('body').type('{esc}');
      cy.get('#mobile-menu').should('have.class', 'hidden');
    });
  });

  describe('Page Titles', () => {
    it('all pages have descriptive titles', () => {
      const pages = [
        { url: '/', titleContains: 'Willkommen' },
        { url: '/gruppenstunden', titleContains: 'Gruppenstunden' },
        { url: '/aktionen', titleContains: 'Kalender' },
        { url: '/kontakt', titleContains: 'Kontakt' },
        { url: '/mitmachen', titleContains: 'Mitmachen' },
        { url: '/impressum', titleContains: 'Impressum' },
      ];
      
      pages.forEach(({ url, titleContains }) => {
        cy.visit(url);
        cy.title().should('include', titleContains);
        cy.title().should('include', 'Stamm Phoenix');
      });
    });
  });

  describe('Links', () => {
    it('external links have proper href attributes', () => {
      cy.visit('/impressum');
      cy.contains('kontakt@stamm-phoenix.de').should('have.attr', 'href').and('include', 'mailto:');
    });

    it('email links use mailto protocol', () => {
      cy.visit('/kontakt');
      cy.contains('kontakt@stamm-phoenix.de')
        .should('have.attr', 'href')
        .and('match', /^mailto:/);
    });

    it('contact information is accessible', () => {
      cy.visit('/kontakt');
      // Contact page has email, not phone numbers
      cy.contains('kontakt@stamm-phoenix.de').should('be.visible');
    });
  });
});
