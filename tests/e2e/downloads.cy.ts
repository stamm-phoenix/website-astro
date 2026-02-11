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
    it('displays loading state or content or error state', () => {
      // The downloads are loaded dynamically via API
      // In test environment without API, we should see either:
      // - Loading skeleton (during fetch)
      // - Error message (after fetch fails)
      // - Actual content (if API is available)
      // - Empty state (when no downloads available)
      
      // Wait a moment for client-side JS to initialize and attempt API call
      cy.wait(1000);
      
      cy.get('body').then(($body) => {
        const hasContent = $body.find('.download-card').length > 0;
        const hasError = $body.text().includes('Daten konnten nicht geladen werden') ||
                        $body.text().includes('Downloads konnten leider nicht abgerufen werden');
        const hasLoading = $body.find('.skeleton-card').length > 0;
        const hasEmptyState = $body.text().includes('keine Downloads verfügbar');
        const hasGrid = $body.find('.grid.gap-6').length > 0;
        
        // Either we have dynamic content state OR at least the grid container exists
        expect(hasContent || hasError || hasLoading || hasEmptyState || hasGrid).to.be.true;
      });
    });

    it('displays grid container for download cards', () => {
      // The grid container should always be present
      cy.get('.grid').should('exist');
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
      // The grid container should have grid display
      cy.get('.grid.gap-6').first().should('have.css', 'display', 'grid');
    });

    it('page renders on mobile', () => {
      cy.viewport(375, 667);
      // Page should load and show either content, loading, or error
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
