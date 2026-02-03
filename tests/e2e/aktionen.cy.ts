/// <reference types="cypress" />

describe('Aktionen (Events) Page', () => {
  beforeEach(() => {
    cy.visit('/aktionen');
  });

  it('loads successfully with correct title', () => {
    cy.title().should('include', 'Kalender');
    cy.get('h1').should('contain', 'Kalender');
  });

  it('displays page header and description', () => {
    cy.contains('Termine').should('be.visible');
    cy.contains('Hier finden Sie kommende Aktionen und Termine unseres Stammes').should('be.visible');
  });

  describe('Filter Buttons', () => {
    it('displays all filter buttons', () => {
      cy.get('#filter-buttons').within(() => {
        cy.contains('Alle').should('be.visible');
        cy.contains('Wölflinge').should('be.visible');
        cy.contains('Jungpfadfinder').should('be.visible');
        cy.contains('Pfadfinder').should('be.visible');
        cy.contains('Rover').should('be.visible');
      });
    });

    it('has "Alle" filter active by default', () => {
      cy.get('.filter-btn[data-group="alle"]').should('have.attr', 'aria-pressed', 'true');
    });

    it('activates filter when clicked', () => {
      cy.get('.filter-btn[data-group="woelflinge"]').click();
      cy.get('.filter-btn[data-group="woelflinge"]').should('have.attr', 'aria-pressed', 'true');
      cy.get('.filter-btn[data-group="alle"]').should('have.attr', 'aria-pressed', 'false');
    });

    it('updates URL when filter is selected', () => {
      cy.get('.filter-btn[data-group="woelflinge"]').click();
      cy.url().should('include', 'gruppe=woelflinge');
    });

    it('removes URL param when "Alle" is selected', () => {
      cy.get('.filter-btn[data-group="woelflinge"]').click();
      cy.url().should('include', 'gruppe=woelflinge');
      
      cy.get('.filter-btn[data-group="alle"]').click();
      cy.url().should('not.include', 'gruppe=');
    });

    it('respects initial URL filter parameter', () => {
      cy.visit('/aktionen?gruppe=jungpfadfinder');
      cy.get('.filter-btn[data-group="jungpfadfinder"]').should('have.attr', 'aria-pressed', 'true');
    });

    it('filters events when group is selected', () => {
      cy.get('#events-list .event-item').then(($cards) => {
        if ($cards.length > 0) {
          const initialCount = $cards.length;
          
          cy.get('.filter-btn[data-group="woelflinge"]').click();
          
          cy.get('#events-list .event-item:not(.hidden)').then(($visibleCards) => {
            // Either fewer cards visible or all cards belong to Wölflinge
            $visibleCards.each((_, card) => {
              const groups = Cypress.$(card).data('groups') || '';
              if (groups) {
                expect(groups).to.include('woelflinge');
              }
            });
          });
        }
      });
    });

    it('shows all events when "Alle" is selected after filtering', () => {
      cy.get('#events-list .event-item').then(($cards) => {
        if ($cards.length > 0) {
          const totalCount = $cards.length;
          
          cy.get('.filter-btn[data-group="woelflinge"]').click();
          cy.get('.filter-btn[data-group="alle"]').click();
          
          cy.get('#events-list .event-item:not(.hidden)').should('have.length', totalCount);
        }
      });
    });
  });

  describe('Event Cards', () => {
    it('displays events list or empty state message', () => {
      cy.get('body').then(($body) => {
        if ($body.find('#events-list').length > 0) {
          cy.get('#events-list').should('be.visible');
        } else {
          cy.contains('Aktuell sind keine bevorstehenden Termine vorhanden').should('be.visible');
        }
      });
    });

    it('event cards have required information', () => {
      cy.get('#events-list .event-item').first().then(($card) => {
        if ($card.length > 0) {
          // Cards should have title and date information
          cy.wrap($card).find('h3, [class*="title"]').should('exist');
        }
      });
    });

    it('event cards are clickable and link to detail page', () => {
      cy.get('#events-list .event-item a').first().then(($link) => {
        if ($link.length > 0) {
          const href = $link.attr('href');
          if (href && href.includes('/aktionen/')) {
            cy.wrap($link).click();
            cy.url().should('include', '/aktionen/');
          }
        }
      });
    });
  });

  describe('Responsive Layout', () => {
    it('displays grid layout on desktop', () => {
      cy.viewport(1280, 720);
      cy.get('#events-list').should('have.class', 'md:grid-cols-2');
    });

    it('displays stacked layout on mobile', () => {
      cy.viewport(375, 667);
      cy.get('#events-list').should('be.visible');
    });
  });
});
