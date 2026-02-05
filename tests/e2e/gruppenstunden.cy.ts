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
    cy.contains('Hier finden Sie eine Übersicht unserer wöchentlichen Gruppenstunden').should('be.visible');
  });

  describe('Group Cards', () => {
    it('displays all four age groups', () => {
      cy.contains('Wölflinge').should('be.visible');
      cy.contains('Jungpfadfinder').should('be.visible');
      cy.contains('Pfadfinder').should('be.visible');
      cy.contains('Rover').should('be.visible');
    });

    it('shows Wölflinge group details', () => {
      cy.contains('Wölflinge').parents('article.surface').first().within(() => {
        cy.contains('7–9 Jahre').should('be.visible');
        cy.contains('Montags').should('be.visible');
        cy.contains('17:30–19:00').should('be.visible');
      });
    });

    it('shows age ranges for all groups', () => {
      cy.contains('7–9 Jahre').should('be.visible');
      cy.contains('10–12 Jahre').should('be.visible');
      cy.contains('13–15 Jahre').should('be.visible');
      cy.contains('16–18 Jahre').should('be.visible');
    });

    it('shows meeting days for groups', () => {
      cy.contains('Montags').should('be.visible');
    });

    it('shows meeting times for groups', () => {
      const timePattern = /\d{1,2}:\d{2}/;
      // Scope time check to group cards only (articles with border-left-width indicating GroupCard)
      // GroupCard uses 'border-l-4' class, while CTA Card does not
      cy.get('article.surface').filter(':has(img[alt$="Stufenlilie"])').each(($card) => {
        // Each group card should contain a time pattern
        expect($card.text()).to.match(timePattern);
      });
    });

    it('displays group logos', () => {
      cy.get('img[alt="Wölflinge Stufenlilie"]').should('be.visible');
      cy.get('img[alt="Jungpfadfinder Stufenlilie"]').should('be.visible');
      cy.get('img[alt="Pfadfinder Stufenlilie"]').should('be.visible');
      cy.get('img[alt="Rover Stufenlilie"]').should('be.visible');
    });

    it('displays colored left borders for groups', () => {
      // Each group card should have a colored left border
      cy.contains('Wölflinge').parents('article.surface').first()
        .should('have.css', 'border-left-style', 'solid');
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
      cy.contains('Schreiben Sie uns eine E-Mail und wir laden Sie zu einer kostenlosen Schnupperstunde ein').should('be.visible');
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
    it('displays cards in grid on desktop', () => {
      cy.viewport(1280, 720);
      // CardGrid uses Tailwind 'grid' class - find the grid container that holds the group cards
      cy.get('article.surface').first().parent().then(($grid) => {
        const display = $grid.css('display');
        expect(display).to.eq('grid');
        const columns = $grid.css('grid-template-columns');
        // Should have multiple columns (more than one value)
        expect(columns).to.not.eq('none');
        expect(columns.split(' ').length).to.be.greaterThan(1);
      });
    });

    it('displays cards stacked on mobile', () => {
      cy.viewport(375, 667);
      cy.contains('Wölflinge').should('be.visible');
      cy.contains('Rover').should('be.visible');
      // Verify cards are stacked vertically by checking their x-positions are approximately equal
      cy.contains('Wölflinge').parents('article.surface').first().then(($woelflinge) => {
        cy.contains('Rover').parents('article.surface').first().then(($rover) => {
          const woelflingeRect = $woelflinge[0].getBoundingClientRect();
          const roverRect = $rover[0].getBoundingClientRect();
          // X positions should be approximately equal (within 10px tolerance) indicating vertical stacking
          expect(Math.abs(woelflingeRect.left - roverRect.left)).to.be.lessThan(10);
        });
      });
    });
  });
});
