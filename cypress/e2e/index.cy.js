describe('Homepage', () => {
  it('loads successfully', () => {
    cy.visit('/');
    cy.contains('Stamm Phoenix'); 
    cy.get('h1').should('be.visible');
  });
});
