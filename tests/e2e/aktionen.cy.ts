/// <reference types="cypress" />

const mockAktionen = [
  {
    id: "test-event-1",
    stufen: ["Wölflinge"],
    title: "Test Event 1",
    description: "This is a description for Test Event 1.",
    campflow_link: "https://example.com/event1",
    start: "2026-02-01",
    end: "2026-02-01"
  },
  {
    id: "test-event-2",
    stufen: ["Jungpfadfinder"],
    title: "Test Event 2",
    description: "Another test event description.",
    campflow_link: "https://example.com/event2",
    start: "2026-02-05",
    end: "2026-02-05"
  },
  {
    id: "test-event-3",
    stufen: ["Pfadfinder", "Rover"],
    title: "All Day Test Event",
    description: "An all day event.",
    start: "2026-02-10",
    end: "2026-02-11"
  }
];

describe('Aktionen (Events) Page', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/aktionen', {
      statusCode: 200,
      body: mockAktionen
    }).as('getAktionen');
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
      cy.visit('/aktionen?gruppe=jupfis');
      cy.get('.filter-btn[data-group="jupfis"]').should('have.attr', 'aria-pressed', 'true');
    });

    it('filters events when group is selected', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
      
      cy.get('.filter-btn[data-group="woelflinge"]').click();
      
      cy.get('#events-list .event-item:not(.hidden)').each(($card) => {
        const groups = $card.attr('data-groups') || '';
        expect(groups).to.include('woelflinge');
      });
    });

    it('shows all events when "Alle" is selected after filtering', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
      
      cy.get('#events-list .event-item').then(($cards) => {
        const totalCount = $cards.length;
        
        cy.get('.filter-btn[data-group="woelflinge"]').click();
        cy.get('.filter-btn[data-group="alle"]').click();
        
        cy.get('#events-list .event-item').should('have.length', totalCount);
      });
    });
  });

  describe('Event Cards', () => {
    it('displays events list after loading', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      cy.get('#events-list .event-item').should('have.length', 3);
    });

    it('displays empty state message when no events', () => {
      cy.intercept('GET', '/api/aktionen', {
        statusCode: 200,
        body: []
      }).as('getEmptyAktionen');
      cy.visit('/aktionen');
      cy.wait('@getEmptyAktionen');
      cy.contains('Aktuell sind keine bevorstehenden Termine vorhanden', { timeout: 10000 }).should('be.visible');
    });

    it('event cards have required information', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list .event-item', { timeout: 10000 }).first().within(() => {
        cy.get('h3').should('exist');
      });
    });

    it('event cards are clickable and link to detail page', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list .event-item', { timeout: 10000 }).first().find('a[href*="/aktionen/"]').click();
      cy.url().should('include', '/aktionen/');
    });
  });

  describe('Responsive Layout', () => {
    it('displays grid layout on desktop', () => {
      cy.viewport(1280, 720);
      cy.wait('@getAktionen');
      cy.get('#events-list', { timeout: 10000 }).should('be.visible')
        .and('have.css', 'display', 'grid')
        .invoke('css', 'grid-template-columns')
        .should('not.eq', 'none')
        .and('not.match', /^[^,\s]+$/);
    });

    it('displays stacked layout on mobile', () => {
      cy.viewport(375, 667);
      cy.wait('@getAktionen');
      cy.get('#events-list', { timeout: 10000 }).should('be.visible').then(($el) => {
        const display = $el.css('display');
        if (display === 'grid') {
          const columns = $el.css('grid-template-columns');
          expect(columns).to.match(/^[\d.]+px$/);
        } else {
          expect(['block', 'flex']).to.include(display);
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('displays error state when API fails', () => {
      cy.intercept('GET', '/api/aktionen', {
        statusCode: 500,
        body: { error: 'Internal Server Error' }
      }).as('getAktionenError');
      cy.visit('/aktionen');
      cy.wait('@getAktionenError');
      cy.contains('Daten konnten nicht geladen werden', { timeout: 10000 }).should('be.visible');
    });
  });
});
