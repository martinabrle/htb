# Trabant Leap Agent

A fictional automotive service prototype with source-backed answers and simulated actions. It does not support real vehicles.

## Run locally

Use Node.js 24 or later. There are no dependencies to install.

```powershell
node src\server.js
```

Open `http://127.0.0.1:3000`. The defaults match `.env.sample`; set `PORT` to override the port. For a hosted process, set `HOST=0.0.0.0` and the host-provided `PORT`. Authentication and audience restrictions must be provided by the hosting perimeter; the app has no sign-in.

Run the loopback HTTP acceptance tests with `node --test`.

See the [POC architecture](./docs/architecture.md) for the implementation boundary and how it relates to the [original concept](./idea/HTB-Idea-Review-Mobility-solution.md).

## Demo paths

- **Warranty coverage** and **Maintenance schedule** quote versioned fictional text. Follow the citation link to its exact excerpt in the **Fictional source library**.
- **Workshop appointment**: select **Fictional workshop** and **Fictional time slot**, then **Preview appointment draft**. Check **I confirm this fictional appointment draft.** and choose **Confirm simulated appointment**. No booking is sent.
- **Urgent safety concern** immediately shows **Simulated human handoff**. No diagnosis is made and no one is contacted.
- **Unsupported guidance** shows **Insufficient evidence**, with no answer or action.

The scenario buttons have `data-scenario` attributes; `#response[data-outcome]` exposes the current result kind. The draft has its own `[data-outcome="appointment_draft"]`.

## HTTP API

| Route | Request and result |
| --- | --- |
| `GET /healthz` | `200` with `{ "status": "ok" }`. |
| `GET /readyz` | `200` with `status: "ready"` when assets and fixture references are available; otherwise `503` with `status: "not_ready"`. |
| `GET /api/demo` | Lists `scenarios`, versioned `sources`, and `workshops` with their fictional `slots`. |
| `POST /api/scenario` | `{ scenarioId }` returns `grounded_answer` with `answer` and `citations`, `appointment_selection`, `human_handoff` with `advisorContacted: false`, or `insufficient_evidence`. |
| `POST /api/appointments/preview` | `{ workshopId, slotId }` returns an `appointment_draft` with `draft.id` and `requiresConfirmation: true`. |
| `POST /api/appointments/confirm` | `{ workshopId, slotId, draftId, confirm: true }` requires a matching preview and returns `appointment_confirmed` with `simulated: true` and `bookingSent: false`. |

POSTs accept only JSON fixture fields. Invalid input returns `400`; a missing, stale, mismatched, or reused preview returns `409` when a draft ID is supplied. APIs are same-origin only. No free text, personal data, cloud AI, external requests, analytics, actual bookings or contacts, or durable writes are used. Dates are fixed examples, not availability. Pending drafts are bounded, expire after ten minutes, and are local to the process, so they do not survive a restart or work across replicas.

## Restricted Azure demo

The [Azure templates](./infra/main.bicep) target one Linux App Service F1 instance in Sweden Central. The [deployment script](./infra/deploy.ps1) uses PowerShell 7, Azure CLI 2.48.1 or later with Bicep, and an Azure CLI sign-in that can deploy at subscription scope and create an application registration in the target workforce tenant.

Confirm the active subscription before you run either command:

```powershell
$subscriptionId = az account show --query id --output tsv
.\infra\deploy.ps1 -SubscriptionId $subscriptionId -ValidateOnly
# Run only after approving resource and directory changes:
.\infra\deploy.ps1 -SubscriptionId $subscriptionId
```

The script prints the dedicated Entra registration object ID. If a deployment stops after creating it, pass that exact ID as `-RegistrationObjectId` when retrying within the same demo. The script stops rather than changing region, moving to a paid SKU, or allowing anonymous application access.

After publishing, open the app URL and sign in with the same Entra user that ran the deployment. If the root returns `401`, open `/.auth/login/aad?post_login_redirect_uri=%2F` on the same host. Verify all [demo paths](#demo-paths); a fresh browser without a sign-in must not receive the UI or the catalog API. If a second same-tenant test account is available, confirm that it is denied too. The only unauthenticated app responses should be the status-only `/healthz` and `/readyz` checks.

To tear down, first verify the dedicated group and registration are yours and no longer needed. Delete the demo resource group in Azure and delete the dedicated registration separately in Microsoft Entra. Deleting the resource group does not delete the app registration.
