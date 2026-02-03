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
      cy.contains('Wölflinge').parents('.surface, [class*="card"]').first().within(() => {
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
      // Scope time check to each group card
      cy.get('.surface, [class*="card"]').each(($card) => {
        // Each group card should contain a time pattern
        expect($card.text()).to.match(timePattern);
      });
    });
  });

  it('displays contact link for Schnupperstunde', () => {
    cy.contains('Interesse an einer Schnupperstunde?').should('be.visible');
    cy.contains('a', 'Kontaktieren Sie uns').should('have.attr', 'href', '/kontakt');
  });

  it('contact link navigates to kontakt page', () => {
    cy.contains('a', 'Kontaktieren Sie uns').click();
    cy.url().should('include', '/kontakt');
  });

  describe('Responsive Layout', () => {
    it('displays cards in grid on desktop', () => {
      cy.viewport(1280, 720);
      cy.get('[class*="grid"]').should('be.visible').first().then(($grid) => {
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
      cy.contains('Wölflinge').parents('.surface, [class*="card"]').first().then(($woelflinge) => {
        cy.contains('Rover').parents('.surface, [class*="card"]').first().then(($rover) => {
          const woelflingeRect = $woelflinge[0].getBoundingClientRect();
          const roverRect = $rover[0].getBoundingClientRect();
          // X positions should be approximately equal (within 10px tolerance) indicating vertical stacking
          expect(Math.abs(woelflingeRect.left - roverRect.left)).to.be.lessThan(10);
        });
      });
    });
  });
});
