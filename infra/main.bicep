targetScope = 'subscription'

param location string
param environmentName string
param resourceGroupName string
param appName string
param planName string
param identityName string
param sessionId string
param createdAt string
param deployedBy string

@minLength(36)
@maxLength(36)
param entraClientId string

@minLength(36)
@maxLength(36)
param deployerObjectId string

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource demoGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module hosting './modules/hosting.bicep' = {
  name: 'trabant-demo-hosting'
  scope: demoGroup
  params: {
    location: location
    tags: tags
    appName: appName
    planName: planName
    identityName: identityName
    entraClientId: entraClientId
    deployerObjectId: deployerObjectId
  }
}

output defaultHostName string = hosting.outputs.defaultHostName
output identityPrincipalId string = hosting.outputs.identityPrincipalId
