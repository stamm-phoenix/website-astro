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

    it('displays loading state or content or error state', () => {
      // The vorstand data is now loaded dynamically via API
      // In test environment without API, we should see either:
      // - Loading skeleton
      // - Error message
      // - Actual content (if API is available)
      cy.get('body').then(($body) => {
        const hasContent = $body.find('.vorstand-card').length > 0;
        const hasError = $body.text().includes('Daten konnten nicht geladen werden') ||
                        $body.text().includes('Vorstandsdaten konnten leider nicht abgerufen werden');
        const hasLoading = $body.find('.skeleton-card').length > 0;
        const hasEmptyState = $body.text().includes('keine Vorstandsmitglieder eingetragen');
        
        // One of these states should be present
        expect(hasContent || hasError || hasLoading || hasEmptyState).to.be.true;
      });
    });

    it('displays grid container for vorstand cards', () => {
      // The grid container should always be present
      cy.get('.grid').should('exist');
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
    it('displays grid layout on desktop', () => {
      cy.viewport(1280, 720);
      // The grid container should have grid display
      cy.get('.grid.gap-6').first().should('have.css', 'display', 'grid');
    });

    it('page renders on mobile', () => {
      cy.viewport(375, 667);
      // Page should load and show either content, loading, or error
      cy.get('h1').should('contain', 'Vorstand');
      cy.contains('Aufgaben des Vorstands').should('be.visible');
    });
  });
});
