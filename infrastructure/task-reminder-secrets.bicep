// Can be reapplied for certificate rotation without replacing Function App settings.
targetScope = 'resourceGroup'
param websiteName string = 'website-astro'
param workerName string = 'website-astro-task-reminders'
param workerPrincipalId string
param location string = resourceGroup().location
resource website 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: websiteName
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'taskcert${uniqueString(resourceGroup().id, workerName)}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: false
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 30
    accessPolicies: [{
      tenantId: subscription().tenantId
      objectId: workerPrincipalId
      permissions: { secrets: ['get'] }
    }]
  }
}
resource certificate 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: 'website-client-certificate'
  parent: vault
  properties: {
    value: website.listAppSettings().properties.AZURE_CLIENT_CERT
  }
}
output vaultName string = vault.name
