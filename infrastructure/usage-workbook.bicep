// The statistics of the Leitendenbereich (docs/nutzungsstatistik.md): a workbook on the usage
// events in Application Insights and 90 days of retention for them, which the workspace-based
// Application Insights includes without extra charge. Can be reapplied after changing the workbook.
targetScope = 'resourceGroup'
param insightsName string = 'website-astro-insights'
param workspaceName string = 'website-astro-logs'
param location string = resourceGroup().location

resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: insightsName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

// customEvents of Application Insights; the rest of the workspace keeps its 30 days
resource appEvents 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = {
  parent: workspace
  name: 'AppEvents'
  properties: {
    retentionInDays: 90
    totalRetentionInDays: 90
  }
}

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'leitendenbereich-nutzung')
  location: location
  kind: 'shared'
  properties: {
    displayName: 'Nutzung des Leitendenbereichs'
    category: 'workbook'
    sourceId: insights.id
    serializedData: loadTextContent('usage-workbook.json')
  }
}

output workbookId string = workbook.id
