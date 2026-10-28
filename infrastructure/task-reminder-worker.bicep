// Initial provisioning only. For certificate rotation use scripts/rotate-task-worker-certificate.sh.
// App settings replace the full collection; reapplying after code deployment requires restoring
// deployment-managed settings such as WEBSITE_RUN_FROM_PACKAGE.
targetScope = 'resourceGroup'

@description('Existing Static Web App whose website certificate is also used for SQL and Graph.')
param websiteName string = 'website-astro'
param workerName string = 'website-astro-task-reminders'
param location string = resourceGroup().location
@description('Enable only after the production task migrations and worker code are deployed.')
param enabled bool = false
@description('Enable the reminders of the Leitendenrunde only after the migration 0046 and the worker code are deployed.')
param leitendenrundeEnabled bool = false

var certificateVaultName = 'taskcert${uniqueString(resourceGroup().id, workerName)}'
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'tasktimer${uniqueString(resourceGroup().id, workerName)}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${workerName}-plan'
  location: location
  kind: 'linux'
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${workerName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: workerName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
  }
}
var storageConnection = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
resource worker 'Microsoft.Web/sites@2023-12-01' = {
  name: workerName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }
        { name: 'FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR', value: 'true' }
        { name: 'AzureWebJobsStorage', value: storageConnection }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: storageConnection }
        { name: 'WEBSITE_CONTENTSHARE', value: toLower(workerName) }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENABLE_ORYX_BUILD', value: 'false' }
        { name: 'TASK_REMINDERS_ENABLED', value: enabled ? 'true' : 'false' }
        { name: 'LEITENDENRUNDE_REMINDERS_ENABLED', value: leitendenrundeEnabled ? 'true' : 'false' }
        { name: 'CAMPFLOW_API_TOKEN', value: '@Microsoft.KeyVault(SecretUri=https://${certificateVaultName}.vault.azure.net/secrets/campflow-api-token)' }
        { name: 'AZURE_CLIENT_CERT', value: '@Microsoft.KeyVault(SecretUri=https://${certificateVaultName}.vault.azure.net/secrets/website-client-certificate)' }
      ]
    }
  }
}
module certificateVault './task-reminder-secrets.bicep' = {
  name: 'task-reminder-certificate'
  params: {
    websiteName: websiteName
    workerName: workerName
    workerPrincipalId: worker.identity.principalId
    location: location
  }
}
output functionAppName string = worker.name
