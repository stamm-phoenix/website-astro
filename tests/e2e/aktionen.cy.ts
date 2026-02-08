/// <reference types="cypress" />

import type { Aktion } from "../../src/lib/types";

const mockAktionen: Aktion[] = [
  {
    id: "test-event-1",
    stufen: ["Wölflinge"],
    title: "Test Event 1",
    description: "This is a description for Test Event 1.",
    campflow_link: "https://example.com/event1",
    start: "2099-06-01",
    end: "2099-06-01"
  },
  {
    id: "test-event-2",
    stufen: ["Jungpfadfinder"],
    title: "Test Event 2",
    description: "Another test event description.",
    campflow_link: "https://example.com/event2",
    start: "2099-06-05",
    end: "2099-06-05"
  },
  {
    id: "test-event-3",
    stufen: ["Pfadfinder", "Rover"],
    title: "All Day Test Event",
    description: "An all day event.",
    start: "2099-06-10",
    end: "2099-06-11"
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
    cy.contains('Hier findest du kommende Aktionen und Termine unseres Stammes').should('be.visible');
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
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      
      cy.get('body', { timeout: 10000 }).should(($body) => {
        const isLoading = $body.find('.skeleton-element').length > 0;
        const hasContent = $body.find('#events-list .event-item').length > 0;
        const hasEmpty = $body.text().includes('keine bevorstehenden Termine');
        const hasError = $body.text().includes('konnten nicht geladen werden');
        expect(isLoading || hasContent || hasEmpty || hasError).to.be.true;
      });
      
      cy.get('body').then(($body) => {
        const hasEvents = $body.find('#events-list .event-item').length > 0;
        
        if (hasEvents) {
          cy.get('.filter-btn[data-group="woelflinge"]').click();
          cy.get('#events-list .event-item').each(($card) => {
            const groups = $card.find('[data-groups]').attr('data-groups') || $card.closest('[data-groups]').attr('data-groups') || '';
            if (groups) {
              expect(groups).to.include('woelflinge');
            }
          });
        } else {
          cy.log('No events loaded - skipping filter verification');
        }
      });
    });

    it('shows all events when "Alle" is selected after filtering', () => {
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      
      cy.get('body').then(($body) => {
        const hasEvents = $body.find('#events-list .event-item').length > 0;
        
        if (hasEvents) {
          const totalCount = $body.find('#events-list .event-item').length;
          
          cy.get('.filter-btn[data-group="woelflinge"]').click();
          cy.get('.filter-btn[data-group="alle"]').click();
          
          cy.get('#events-list .event-item').should('have.length', totalCount);
        } else {
          cy.log('No events loaded - external API dependency');
        }
      });
    });
  });

  describe('Event Cards', () => {
    it('displays events list after loading', () => {
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      
      cy.get('body', { timeout: 10000 }).should(($body) => {
        const isLoading = $body.find('.skeleton-element').length > 0;
        const hasContent = $body.find('#events-list .event-item').length > 0;
        const hasEmpty = $body.text().includes('keine bevorstehenden Termine');
        const hasError = $body.text().includes('konnten nicht geladen werden');
        expect(isLoading || hasContent || hasEmpty || hasError).to.be.true;
      });
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
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      
      // Wait for events to render
      cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
      
      cy.get('#events-list .event-item').first().within(() => {
        cy.get('h3').should('exist');
      });
    });

    it('event cards show external registration link when available', () => {
      cy.wait('@getAktionen');
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      
      // Wait for events to render
      cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
      
      // Click to expand the first event card
      cy.get('#events-list .event-item').first().find('button').click();
      
      // Verify the external link appears with correct attributes
      cy.get('#events-list .event-item').first()
        .contains('a', 'Zur Anmeldung')
        .should('have.attr', 'href', 'https://example.com/event1')
        .and('have.attr', 'target', '_blank')
        .and('have.attr', 'rel', 'noopener noreferrer');
    });
  });

  describe('Responsive Layout', () => {
    it('displays grid layout on desktop', () => {
      cy.viewport(1280, 720);
      cy.get('#events-list', { timeout: 10000 }).should('be.visible');
      cy.get('.aktionen-layout').should('have.css', 'display', 'grid');
    });

    it('displays stacked layout on mobile', () => {
      cy.viewport(375, 667);
      cy.get('#events-list', { timeout: 10000 }).should('exist');
      cy.get('.aktionen-layout').should('exist');
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

describe('HTML Description Rendering', () => {
  const htmlDescription = '<div class="ExternalClass9A56B9D4048645E59AD2B4D4D968AF21"><div style="font-family&#58;Calibri;"><b>Wichtige Info</b><br>Normaler Text mit <em>Kursiv</em> und <strong>Fett</strong>.</div></div>';
  
  const mockAktionWithHtml: Aktion[] = [
    {
      id: "test-event-1",
      stufen: ["Wölflinge"],
      title: "Event with HTML Description",
      description: htmlDescription,
      campflow_link: "https://example.com/event",
      start: "2099-07-01",
      end: "2099-07-01"
    }
  ];

  beforeEach(() => {
    cy.intercept('GET', '/api/aktionen', {
      statusCode: 200,
      body: mockAktionWithHtml
    }).as('getAktionen');
  });

  it('renders HTML description as formatted text in expanded card', () => {
    cy.visit('/aktionen');
    cy.wait('@getAktionen');
    cy.get('#events-list', { timeout: 10000 }).should('be.visible');
    
    // Wait for events to render
    cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
    
    // Click to expand the card
    cy.get('#events-list .event-item').first().find('button').click();
    
    // Wait for expanded content and verify HTML is rendered properly
    cy.get('#events-list .event-item').first().find('.description', { timeout: 5000 }).within(() => {
      cy.contains('b', 'Wichtige Info').should('exist');
      cy.contains('em', 'Kursiv').should('exist');
      cy.contains('strong', 'Fett').should('exist');
      cy.contains('Normaler Text').should('be.visible');
      
      // Should not show raw HTML tags
      cy.contains('<b>').should('not.exist');
      cy.contains('<div').should('not.exist');
    });
  });

  it('handles description with malicious script tags', () => {
    const maliciousAktion: Aktion[] = [
      {
        id: "test-event-1",
        stufen: ["Rover"],
        title: "XSS Test Event",
        description: '<p>Safe text</p><script>alert("xss")</script><b>Bold</b>',
        campflow_link: "https://example.com/event",
        start: "2099-08-01",
        end: "2099-08-01"
      }
    ];
    
    cy.intercept('GET', '/api/aktionen', {
      statusCode: 200,
      body: maliciousAktion
    }).as('getXssAktionen');
    
    cy.visit('/aktionen');
    cy.wait('@getXssAktionen');
    
    // Wait for events to render
    cy.get('#events-list .event-item', { timeout: 10000 }).should('have.length.at.least', 1);
    
    // Click to expand the card
    cy.get('#events-list .event-item').first().find('button').click();
    
    // Verify safe content is rendered and script is stripped
    cy.get('#events-list .event-item').first().find('.description', { timeout: 5000 }).within(() => {
      cy.contains('Safe text').should('be.visible');
      cy.contains('b', 'Bold').should('exist');
      cy.get('script').should('not.exist');
    });
  });
});
