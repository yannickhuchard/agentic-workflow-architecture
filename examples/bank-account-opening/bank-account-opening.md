# Retail Bank Account Opening Workflow

## Executive Summary
This document details the end-to-end workflow for opening a retail bank account. It is designed to be fully automated (Straight-Through Processing) for the majority of applicants, utilizing AI agents for verification and decisioning, while retaining human oversight for exceptions.

## Process Metadata
- **Process Owner**: Head of Retail Onboarding
- **Version**: 2.0 (Agentic Architecture)
- **Status**: Live
- **Target SLA**: < 10 minutes (Happy Path)
- **Max SLA**: 24 hours (Manual Review)
- **Compliance**: GDPR, KYC (Know Your Customer), AML (Anti-Money Laundering), FATCA.

## Actors & Roles

| Actor | Type | Description |
| :--- | :--- | :--- |
| **Applicant** | `Human` | The potential customer initiating the account opening. |
| **Onboarding Agent** | `AI Agent` | Orchestrates the session, guides the user, and validates comprehensive input. |
| **Identity Verification Service** | `External API` | Third-party provider for biometric and ID document verification (e.g., Onfido, Jumio). |
| **Risk Engine** | `AI Agent` | Synthesizes data from internal and credit bureaus to calculate risk scores. |
| **Compliance Officer** | `Human` | Reviews high-risk applications and AML flags. |
| **Core Banking System** | `Application` | The system of record for accounts and customer data. |
| **Credit Bureau** | `External API` | Third-party provider for credit history (e.g., Equifax, Experian). |
| **Upsell Engine** | `AI Agent` | Analyzes customer profile to recommend relevant additional products. |

## Workflow Steps

### 1. Identity Verification
**Actor**: Applicant <-> Onboarding Agent <-> Identity Verification Service
**Description**: The applicant captures their ID document and a live selfie. The agent validates authenticity.
- **Input Data**: `image/jpeg` (ID Front), `image/jpeg` (ID Back), `image/jpeg` (Selfie).
- **Constraints**: 
    - Image quality score > 80.
    - Liveness check must pass.
    - ID document must not be expired.
- **API Interaction**: `POST /api/v1/verify-identity`
- **Output Data**: `verification_token`, `extracted_data` (Name, DOB, Address, ID Number).
- **Happy Path Duration**: 30 seconds.

### 2. Data Capture & Validation
**Actor**: Applicant <-> Onboarding Agent
**Description**: Applicant confirms extracted data and provides missing details (Tax Residency, Employment Status, Source of Funds).
- **Input Data**:
    ```json
    {
      "tax_residency": "US",
      "tin": "123-45-6789",
      "employment_status": "Employed",
      "annual_income": 85000,
      "source_of_funds": "Salary"
    }
    ```
- **Validation**:
    - TIN format check against country rules.
    - Address normalization (Google Maps API).
- **Happy Path Duration**: 2 minutes.

### 3. Anti-Money Laundering (AML) Screening
**Actor**: Onboarding Agent <-> AML Service
**Description**: The applicant's name is screened against PEPS (Politically Exposed Persons) and Sanction lists.
- **Input Data**: `first_name`, `last_name`, `dob`, `country`.
- **API Interaction**: `POST /api/v1/aml/screen`
- **Output Data**: `aml_status` ("CLEAR" | "REVIEW"), `match_confidence`.
- **Constraint**: If `aml_status` == "REVIEW", workflow suspends and routes to **Compliance Officer**.

### 4. Credit Worthiness Check
**Actor**: Risk Engine <-> Credit Bureau
**Description**: Soft pull of credit report to assess financial health.
- **Input Data**: `ssn` (or national id), `address`.
- **API Interaction**: `POST /api/v1/bureau/credit-report`
- **Output Data**: `credit_score` (300-850), `bankruptcy_indicator` (bool).
- **Constraint**: Minimum credit score of 600 required for standard accounts.

### 5. Automated Risk Assessment
**Actor**: Risk Engine
**Description**: A holistic risk assessment combining AML results, credit score, and application data (income, employment).
- **Process**:
    1.  Normalize all risk factors.
    2.  Calculate `composite_risk_score` (0-100).
    3.  Determine `account_tier` and `transaction_limits`.
- **Logic**:
    - IF `risk_score` < 20: Low Risk (High Limits, Instant Approval).
    - IF `risk_score` 20-60: Medium Risk (Standard Limits).
    - IF `risk_score` > 60: High Risk (Manual Review required).
- **Output Data**: `risk_profile` object.

### 6. Upsell Offering Proposals
**Actor**: Upsell Engine
**Description**: AI analyzes the applicant's profile (income, age, spending potential) to generate personalized offers.
- **Input Data**: `annual_income`, `credit_score`, `age`, `employment_type`.
- **Algorithm**: Collaborative filtering based on similar customer profiles.
- **Example Proposals**:
    - "Platinum Credit Card" (for high income + high credit score).
    - "Renters Insurance" (for younger demographics in urban areas).
    - "High-Yield Savings" (for high savings potential).
- **Output Data**: List of `offer_id`s with `relevance_score`.

### 7. Account Selection & Configuration
**Actor**: Applicant <-> Onboarding Agent
**Description**: Applicant reviews the standard account details and selects any accepted upsell offers.
- **UI Interaction**: "Select Your Account" screen with "Recommended for You" section.
- **Output Data**: `selected_product_ids`.

### 8. Contract Generation & Signing
**Actor**: Onboarding Agent <-> Applicant
**Description**: Terms & Conditions are dynamically generated, including clauses for selected upsell products. Applicant digitally signs.
- **Input Data**: `applicant_data`, `selected_products`.
- **Process**: Merge data into PDF templates.
- **Integration**: DocuSign or internal signing module.
- **Output Data**: `signed_contract.pdf`, `audit_trail_log`.

### 9. Core Banking Provisioning
**Actor**: Core Banking System
**Description**: The actual account creation in the ledger.
- **API Interaction**: `POST /api/core/customers/{id}/accounts`
- **Action**: 
    - Create CIF (Customer Information File).
    - Generate Account Number / IBAN.
    - Issue Virtual Debit Card.
- **Duration**: < 5 seconds.

### 10. Welcome Package & Access
**Actor**: Notification Service <-> Applicant
**Description**: Sends welcome email, SMS with app download link, and initial login credentials.
- **Channels**: Email, SMS.
- **Content**: Account details, next steps, "How to fund your account".

## Data Dictionary

### Applicant
```json
{
  "id": "uuid",
  "first_name": "string",
  "last_name": "string",
  "dob": "date",
  "contact": {
    "email": "email",
    "phone": "e164"
  },
  "address": {
    "street": "string",
    "city": "string",
    "postal_code": "string",
    "country": "ISO2"
  }
}
```

### RiskProfile
```json
{
  "applicant_id": "uuid",
  "timestamp": "iso8601",
  "credit_score": "integer",
  "aml_status": "CLEAR" | "REVIEW" | "BLOCKED",
  "composite_score": "float",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "assigned_limits": {
      "daily_transfer": "currency",
      "atm_withdrawal": "currency"
  }
}
```

## Exception Handling
- **ID Verification Failure**: User prompted to retry 3 times. If fails, session routed to video call agent.
- **AML Hit**: Account opening paused. `Case` created in Case Management System for Compliance Officer.
- **System Timeout**: Application state saved. User sent a "Resume Application" link via email.
