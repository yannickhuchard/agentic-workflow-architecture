/**
 * Paid Newsletter Sales Funnel — AWA Builder Example
 *
 * Demonstrates the full sales funnel built with the AWA TypeScript fluent API,
 * featuring native verification on every AI agent activity.
 *
 * Usage:
 *   npx tsx examples/paid-newsletter-funnel/build_workflow.ts
 *
 * Author: Yannick HUCHARD
 */

import { workflow } from '../../sdk/typescript/src/builder';

const funnel = workflow('Paid Newsletter Sales Funnel', '1.0.0')
    .description(
        'End-to-end automated sales funnel for paid newsletter registration. ' +
        'All activities are AI agents with native verification.'
    )
    .metadata('author', 'Yannick HUCHARD')
    .metadata('use_case', 'paid_newsletter_registration')
    .metadata('automation_level', 'fully_automated')

    // ─── Shared Context ─────────────────────────────────────────────────
    .context('funnel_state', {
        type: 'state',
        sync_pattern: 'shared_state',
        description: 'Shared state tracking the prospect through the funnel',
        visibility: 'workflow',
    })

    // ─── Step 1: Qualify Lead ───────────────────────────────────────────
    .activity('Qualify Lead', {
        description:
            'Analyze incoming prospect data and produce a lead qualification ' +
            'score with segmentation tags.',
        role_id: 'lead-qualification-agent',
        actor_type: 'ai_agent',
        verification: {
            criteria: [
                {
                    name: 'Structured Output',
                    description:
                        'Output must be JSON with lead_score (0-100), segment (string), qualified (boolean)',
                    type: 'format',
                    required: true,
                },
                {
                    name: 'Score Justification',
                    description:
                        'lead_score must correlate with the interests and referral source',
                    type: 'accuracy',
                    required: true,
                    weight: 0.8,
                },
                {
                    name: 'Segment Validity',
                    description:
                        'segment must be one of: high_value, engaged, casual, low_fit',
                    type: 'compliance',
                    required: true,
                    weight: 0.9,
                },
            ],
            max_retries: 3,
            pass_threshold: 0.9,
        },
    })

    // ─── Step 2: Welcome Email ──────────────────────────────────────────
    .activity('Generate Personalized Welcome Email', {
        description:
            'Compose a personalized welcome email with clear CTA for the paid subscription.',
        role_id: 'email-copywriter-agent',
        actor_type: 'ai_agent',
        verification: {
            criteria: [
                {
                    name: 'Personalization',
                    description:
                        'Email must address prospect by name and reference their interests',
                    type: 'completeness',
                    required: true,
                },
                {
                    name: 'CTA Presence',
                    description:
                        'Must include a clear call-to-action with subscription URL',
                    type: 'completeness',
                    required: true,
                },
                {
                    name: 'CAN-SPAM Elements',
                    description:
                        'Body must include unsubscribe link and physical address placeholders',
                    type: 'compliance',
                    required: true,
                },
                {
                    name: 'Tone & Length',
                    description:
                        'Professional tone, 150-500 words, no spam language',
                    type: 'accuracy',
                    required: false,
                    weight: 0.7,
                },
            ],
            max_retries: 3,
            pass_threshold: 0.9,
        },
    })

    // ─── Step 3: Trial Content ──────────────────────────────────────────
    .activity('Generate Trial Content Preview', {
        description:
            'Create a sample preview of premium newsletter content tailored to interests.',
        role_id: 'content-strategy-agent',
        actor_type: 'ai_agent',
        verification: {
            criteria: [
                {
                    name: 'Interest Alignment',
                    description:
                        'Content must relate to at least one stated interest',
                    type: 'accuracy',
                    required: true,
                },
                {
                    name: 'Teaser Effectiveness',
                    description:
                        'teaser_line must create curiosity without revealing full value',
                    type: 'accuracy',
                    required: true,
                    weight: 0.9,
                },
                {
                    name: 'Content Quality',
                    description:
                        'Preview must be 200+ words, well-structured, demonstrating expertise',
                    type: 'completeness',
                    required: false,
                    weight: 0.8,
                },
            ],
            max_retries: 2,
            pass_threshold: 0.9,
        },
    })

    // ─── Step 4: Landing Page ───────────────────────────────────────────
    .activity('Build Subscription Landing Page', {
        description:
            'Generate conversion-optimized HTML/CSS landing page with pricing, benefits, and checkout.',
        role_id: 'landing-page-builder-agent',
        actor_type: 'ai_agent',
        verification: {
            criteria: [
                {
                    name: 'HTML Validity',
                    description:
                        'Valid HTML with doctype, head, body sections',
                    type: 'format',
                    required: true,
                },
                {
                    name: 'Pricing Section',
                    description:
                        'Must display pricing with monthly amount and subscribe button',
                    type: 'completeness',
                    required: true,
                },
                {
                    name: 'Conversion Elements',
                    description:
                        'Must include: headline, 3+ benefits, testimonial placeholder, 2+ FAQs',
                    type: 'completeness',
                    required: true,
                    weight: 0.9,
                },
            ],
            max_retries: 3,
            pass_threshold: 0.9,
        },
    })

    // ─── Step 5: Payment ────────────────────────────────────────────────
    .activity('Process Payment and Activate Subscription', {
        description:
            'Simulate payment processing: generate subscription record and receipt.',
        role_id: 'payment-processing-agent',
        actor_type: 'ai_agent',
        access_rights: [
            {
                name: 'Stripe API Access',
                resource_type: 'api',
                permission: 'execute',
                scope: 'payment_intents:create,subscriptions:create',
            },
        ],
        verification: {
            criteria: [
                {
                    name: 'Subscription Record',
                    description:
                        'Must include subscription_id (UUID), payment_status ("succeeded"), subscription_start_date (ISO date)',
                    type: 'format',
                    required: true,
                },
                {
                    name: 'Receipt Completeness',
                    description:
                        'Receipt must have: subscriber_name, subscriber_email, amount, currency, tier, transaction_id',
                    type: 'completeness',
                    required: true,
                },
                {
                    name: 'No Raw Card Data',
                    description:
                        'Output must NOT contain any 16-digit card numbers, CVV, or expiration dates',
                    type: 'compliance',
                    required: true,
                },
            ],
            max_retries: 2,
            pass_threshold: 0.9,
        },
    })

    // ─── Step 6: Onboarding ─────────────────────────────────────────────
    .activity('Send Onboarding Sequence', {
        description:
            'Generate a 3-email onboarding drip sequence for the new subscriber.',
        role_id: 'email-copywriter-agent',
        actor_type: 'ai_agent',
        verification: {
            criteria: [
                {
                    name: 'Three Emails',
                    description:
                        'onboarding_emails array must have exactly 3 items with subject, body, send_delay_hours',
                    type: 'format',
                    required: true,
                },
                {
                    name: 'Progressive Timing',
                    description:
                        'Delays: Email 1 at 0h, Email 2 at 24-72h, Email 3 at 72-168h',
                    type: 'accuracy',
                    required: true,
                    weight: 0.9,
                },
                {
                    name: 'Content Progression',
                    description:
                        'Email 1: welcome+value. Email 2: education. Email 3: community+referral. All personalized.',
                    type: 'completeness',
                    required: false,
                    weight: 0.8,
                },
            ],
            max_retries: 2,
            pass_threshold: 0.9,
        },
    })

    // ─── Edges (Sequential Flow) ────────────────────────────────────────
    .edge('Qualify Lead', 'Generate Personalized Welcome Email', { label: 'Lead qualified' })
    .edge('Generate Personalized Welcome Email', 'Generate Trial Content Preview', { label: 'Welcome email composed' })
    .edge('Generate Trial Content Preview', 'Build Subscription Landing Page', { label: 'Trial content generated' })
    .edge('Build Subscription Landing Page', 'Process Payment and Activate Subscription', { label: 'Landing page built' })
    .edge('Process Payment and Activate Subscription', 'Send Onboarding Sequence', { label: 'Payment processed' });

// ─── Build & Output ─────────────────────────────────────────────────────
const workflowDef = funnel.build();

console.log('=== Paid Newsletter Sales Funnel ===');
console.log(`Workflow: ${workflowDef.name} (${workflowDef.id})`);
console.log(`Activities: ${workflowDef.activities.length}`);
console.log(`Edges: ${workflowDef.edges.length}`);
console.log('');

for (const activity of workflowDef.activities) {
    const v = activity.verification;
    const status = v?.enabled ? `✅ ${v.criteria.length} criteria, ${v.max_retries} retries` : '❌ none';
    console.log(`  → ${activity.name} [${activity.actor_type}] — Verification: ${status}`);
}

console.log('');
console.log(JSON.stringify(workflowDef, null, 2));
