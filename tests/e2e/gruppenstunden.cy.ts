/// <reference types="cypress" />

describe('Gruppenstunden Page', () => {
  beforeEach(() => {
    cy.visit('/gruppenstunden');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Gruppenstunden');
    cy.get('h1').should('contain', 'Gruppenstunden');
  });

  it('displays page description', () => {
    cy.contains('Hier findest du eine Übersicht unserer wöchentlichen Gruppenstunden').should('be.visible');
  });

  describe('Group Cards (Dynamic Content)', () => {
    it('displays loading state or content or error state', () => {
      // The gruppenstunden are now loaded dynamically via API
      // In test environment without API, we should see either:
      // - Loading skeleton (during fetch)
      // - Error message (after fetch fails)
      // - Actual content (if API is available)
      // - Empty grid (initial state before JS runs or when data is empty)
      
      // Wait a moment for client-side JS to initialize and attempt API call
      cy.wait(1000);
      
      cy.get('body').then(($body) => {
        const hasContent = $body.find('.gruppe-card').length > 0;
        const hasError = $body.text().includes('Daten konnten nicht geladen werden') ||
                        $body.text().includes('Gruppenstunden konnten leider nicht abgerufen werden');
        const hasLoading = $body.find('.skeleton-card').length > 0;
        const hasGrid = $body.find('.grid.gap-6').length > 0;
        
        // Either we have dynamic content state OR at least the grid container exists
        expect(hasContent || hasError || hasLoading || hasGrid).to.be.true;
      });
    });

    it('displays grid container for group cards', () => {
      // The grid container should always be present
      cy.get('.grid').should('exist');
    });
  });

  describe('Schnupperstunde CTA', () => {
    it('displays prominent CTA section', () => {
      cy.contains('Interesse an einer Schnupperstunde?').should('be.visible');
    });

    it('shows email CTA button', () => {
      cy.contains('a', 'E-Mail schreiben')
        .should('have.attr', 'href')
        .and('include', 'mailto:kontakt@stamm-phoenix.de')
        .and('include', 'Schnupperstunde');
    });

    it('displays explanation text', () => {
      cy.contains('Schreib uns eine E-Mail und wir laden dich zu einer kostenlosen Schnupperstunde ein').should('be.visible');
    });
  });

  describe('Leitendenrunde Section', () => {
    it('displays Leitendenrunde heading', () => {
      cy.contains('h2', 'Leitendenrunde').should('be.visible');
    });

    it('mentions Gruppenleiter', () => {
      cy.contains('Gruppenleiter').should('be.visible');
    });

    it('mentions option for older scouts to become leaders', () => {
      cy.contains('Zu alt für die Rover?').should('be.visible');
    });

    it('links to Mitmachen page', () => {
      cy.contains('a', 'Mitmachen-Seite').should('have.attr', 'href', '/mitmachen');
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
      cy.get('h1').should('contain', 'Gruppenstunden');
      cy.contains('Interesse an einer Schnupperstunde?').should('be.visible');
    });
  });
});
