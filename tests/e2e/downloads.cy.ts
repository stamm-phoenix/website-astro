/// <reference types="cypress" />

describe('Downloads Page', () => {
  beforeEach(() => {
    cy.visit('/downloads');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Downloads');
    cy.get('h1').should('contain', 'Downloads');
  });

  it('displays page description', () => {
    cy.contains('Hier findest du wichtige Dokumente und Dateien zum Herunterladen').should('be.visible');
  });

  describe('Downloads List (Dynamic Content)', () => {
    it('displays loading skeleton while fetching data', () => {
      cy.intercept('GET', '/api/downloads', {
        delay: 500,
        body: []
      }).as('delayedDownloads');

      cy.visit('/downloads');
      cy.get('[data-testid="downloads-grid"] .skeleton-card').should('exist');
    });

    it('displays download cards on successful API response', () => {
      cy.intercept('GET', '/api/downloads', {
        statusCode: 200,
        body: [
          {
            id: 'test-1',
            fileName: 'test-document.pdf',
            size: 1024,
            lastModifiedAt: '2024-01-15T10:00:00Z'
          }
        ]
      }).as('getDownloads');

      cy.visit('/downloads');
      cy.wait('@getDownloads');
      cy.get('[data-testid="downloads-grid"] .download-card, [data-testid="downloads-grid"] article').should('have.length.at.least', 1);
    });

    it('displays empty state when no downloads available', () => {
      cy.intercept('GET', '/api/downloads', {
        statusCode: 200,
        body: []
      }).as('getEmptyDownloads');

      cy.visit('/downloads');
      cy.wait('@getEmptyDownloads');
      cy.contains('keine Downloads verfügbar').should('be.visible');
    });

    it('displays error message on API failure', () => {
      cy.intercept('GET', '/api/downloads', {
        statusCode: 500,
        body: { error: 'Server error' }
      }).as('getDownloadsError');

      cy.visit('/downloads', {
        onBeforeLoad(win) {
          win.sessionStorage.clear();
          win.localStorage.clear();
        }
      });
      cy.wait('@getDownloadsError');
      cy.get('[role="alert"]').should('exist');
      cy.contains('Daten konnten nicht geladen werden').should('be.visible');
    });

    it('displays grid container for download cards', () => {
      cy.get('[data-testid="downloads-grid"]').should('exist');
    });
  });

  describe('Navigation', () => {
    it('is accessible from header navigation', () => {
      cy.get('nav[aria-label="Hauptnavigation"]').contains('Downloads').should('be.visible');
    });

    it('shows as current page in navigation', () => {
      cy.get('nav[aria-label="Hauptnavigation"] a[href="/downloads"]')
        .should('have.attr', 'aria-current', 'page');
    });
  });

  describe('Responsive Layout', () => {
    it('displays grid layout on desktop', () => {
      cy.viewport(1280, 720);
      cy.get('[data-testid="downloads-grid"]').should('have.css', 'display', 'grid');
    });

    it('page renders on mobile', () => {
      cy.viewport(375, 667);
      cy.get('h1').should('contain', 'Downloads');
    });
  });

  describe('Accessibility', () => {
    it('has proper heading hierarchy', () => {
      cy.get('h1').should('have.length', 1);
      cy.get('h1').should('contain', 'Downloads');
    });

    it('has accessible section with hidden heading for screen readers', () => {
      cy.get('#downloads-list-heading').should('exist');
      cy.get('section[aria-labelledby="downloads-list-heading"]').should('exist');
    });
  });
});
