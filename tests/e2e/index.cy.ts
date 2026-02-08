/// <reference types="cypress" />

describe('Homepage', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('loads successfully', () => {
    cy.contains('Stamm Phoenix');
    cy.get('h1').should('be.visible');
  });

  it('displays hero section with correct content', () => {
    cy.get('h1').should('be.visible');
    cy.contains('DPSG Feldkirchen-Westerham').should('be.visible');
  });

  it('displays quick info section', () => {
    cy.contains('Was uns ausmacht').should('be.visible');
    cy.contains('Für alle Altersstufen').should('be.visible');
    cy.contains('Draußen erleben').should('be.visible');
    cy.contains('Werte leben').should('be.visible');
  });

  it('displays CTA section', () => {
    cy.contains('Jetzt entdecken').should('be.visible');
  });

  it('has working primary CTA button', () => {
    cy.get('a[href="/mitmachen"]').first().scrollIntoView().should('be.visible');
  });

  it('has working secondary CTA button linking to Gruppenstunden', () => {
    cy.get('a[href="/gruppenstunden"]').first().should('be.visible');
  });
});
