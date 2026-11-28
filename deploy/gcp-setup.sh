#!/usr/bin/env bash
# One-time setup of the Google Cloud project behind Firebase, so that GitHub Actions can deploy the
# AWA MCP server (.github/workflows/deploy-mcp.yml) without any stored key.
#
# Run it in Google Cloud Shell (https://shell.cloud.google.com), signed in as an owner of the project:
#
#   bash deploy/gcp-setup.sh
#
# It is safe to run again. It prints the two repository variables to set at the end.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-agentic-workflow-architecture}"
REGION="${REGION:-europe-west1}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-yannickhuchard/agentic-workflow-architecture}"
SERVICE_ACCOUNT_NAME="awa-deployer"
POOL="github"
PROVIDER="github"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SERVICE_ACCOUNT="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"
echo "Project $PROJECT_ID (number $PROJECT_NUMBER), region $REGION, repository $GITHUB_REPOSITORY"

echo "1/5 Enabling the APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com

echo "2/5 The image registry"
gcloud artifacts repositories describe awa --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create awa --repository-format docker --location "$REGION" \
    --description "AWA MCP server images"

echo "3/5 The deploying account and its roles"
gcloud iam service-accounts describe "$SERVICE_ACCOUNT" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" --display-name "AWA deployer (GitHub Actions)"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/firebasehosting.admin \
            roles/iam.serviceAccountUser roles/serviceusage.serviceUsageConsumer roles/browser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SERVICE_ACCOUNT" \
    --role "$ROLE" --condition None --quiet >/dev/null
done

echo "4/5 GitHub as an identity provider, limited to this repository's main branch"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location global \
  --workload-identity-pool "$POOL" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location global \
    --workload-identity-pool "$POOL" --display-name "GitHub" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '$GITHUB_REPOSITORY' && assertion.ref == 'refs/heads/main'"

echo "5/5 Letting the repository's workflows act as the deploying account"
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$GITHUB_REPOSITORY" \
  --quiet >/dev/null

PROVIDER_NAME="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
cat <<EOF

Done. Set these two repository variables (Settings, Secrets and variables, Actions, Variables):

  GCP_WORKLOAD_IDENTITY_PROVIDER = $PROVIDER_NAME
  GCP_SERVICE_ACCOUNT            = $SERVICE_ACCOUNT

Or, with the GitHub command line signed in:

  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo $GITHUB_REPOSITORY --body "$PROVIDER_NAME"
  gh variable set GCP_SERVICE_ACCOUNT --repo $GITHUB_REPOSITORY --body "$SERVICE_ACCOUNT"

They are identifiers, not secrets. Then run the workflow "Deploy the MCP server" from the Actions tab.
EOF
