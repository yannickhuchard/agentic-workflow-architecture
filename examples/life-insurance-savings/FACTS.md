# Luxembourg facts this example uses

**This is not tax or legal advice.** The example is fictional: Valoria Life S.A., Kestrel Engineering S.à r.l., Banque Ardenne de Dépôt S.A., the funds and the people do not exist. The rules below are what the workflows apply, with where each figure comes from. Before an insurer relies on any of them, a tax adviser and a lawyer confirm them for the tax year concerned.

The figures were checked on 27 November 2026 with web searches. The official pages could not be opened from the environment the example was written in, so each figure below rests on the text of the page as the search returned it. The marks mean:

- **Confirmed**: an official source (the Luxembourg tax administration, the government's guichet.public.lu, the Commissariat aux Assurances, the Chamber of Deputies, EUR-Lex) states it.
- **Secondary**: only reliable secondary sources (insurers, law firms, the press) state it.
- **To be confirmed by a tax adviser** (or a lawyer): no source found states it, or the sources disagree.

The tax figures live in one place, the decision table **Deduction rules** of `year-end-tax.awa.json` (written by `build-definitions.py`), so that a change of law is a new rule of the table, not a change of code.

## Tax

| Fact | Used where | Mark | Source |
|---|---|---|---|
| Premiums paid into a pension savings contract (prévoyance-vieillesse, **Art. 111bis LIR**) are deductible as special expenses up to **4,500 EUR a year from tax year 2026** | Deduction rules, rule 1; every scenario's certificate | Confirmed | Tax administration, [prévoyance-vieillesse](https://impotsdirects.public.lu/fr/az/p/prevoyance_vieillesse.html): "La déduction fiscale annuelle maximale des versements dans le cadre d'un contrat de prévoyance-vieillesse à titre de dépenses spéciales est de 4 500 euros à partir de l'année d'imposition 2026". Chamber of Deputies, bill 8640, [committee report of 12 December 2025](https://wdocs-pub.chd.lu/docs/Dossiers_parlementaires/8640/20251212_RapportCommission.pdf): "de 3.200 € à 4.500 €" |
| The ceiling was **3,200 EUR a year** up to tax year 2025 | Deduction rules, rule 2 | Confirmed | Same committee report; [guichet.public.lu](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/contrat-prevoyance-resident.html) still showed 3,200 EUR when it was searched |
| The ceiling is the same **whatever the age** of the policyholder | Explain the plan | Confirmed | [guichet.public.lu](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/contrat-prevoyance-resident.html): "peu importe l'âge du souscripteur" |
| The ceiling applies **per taxpayer**; spouses each have their own if each holds a contract | Deduction rules, column "ceiling_basis" | To be confirmed by a tax adviser | The tax administration's page speaks of a yearly maximum; a 2025 insurer's guide reads "par contrat et par contribuable". Whether a taxpayer with two contracts shares one ceiling is not stated in what was found |
| The contract runs **at least 10 years** | Explain the plan; plan terms | Confirmed | [guichet.public.lu](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/contrat-prevoyance-resident.html) |
| The savings are paid **from age 60 and no later than 75** | Explain the plan; plan terms | Confirmed | [Tax administration](https://impotsdirects.public.lu/fr/az/p/prevoyance_vieillesse.html) and [guichet.public.lu (English)](https://guichet.public.lu/en/citoyens/fiscalite/declaration-impot-decompte/pension/depenses-deductibles/contrat-prevoyance-resident.html) |
| The contract must be **subscribed before 65** | Plan terms (`subscription_before_age`) | Secondary | A press article summarising the rules; not found on an official page |
| A capital paid out is taxed at **half the global rate** under conditions | README | Confirmed in outline | [guichet.public.lu, income from a prévoyance-vieillesse plan](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/pension/perception-pension/plan-prevoyance-vieillesse.html); the conditions are to be confirmed by a tax adviser |
| An early surrender is excluded except for **serious illness or disability** | README | Confirmed | [guichet.public.lu](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/contrat-prevoyance-resident.html) |
| The contract is taken out with an insurer or credit institution **approved in Luxembourg** | README | Confirmed | Same page |
| Life, death, accident, disability, sickness and civil liability insurance premiums (**Art. 111 LIR**) are deductible within **672 EUR a year per member of the household**, shared between them | Deduction rules, rule 3 (no scenario uses it) | Confirmed | Tax administration, [cotisations et primes d'assurance](https://impotsdirects.public.lu/fr/az/c/cotis_prim.html); [guichet.public.lu](https://guichet.public.lu/en/citoyens/fiscalite/immobilier/depenses-deductibles/primes-assurance-resident.html); circular [LIR 111/1 of 2 November 2017](https://impotsdirects.public.lu/content/dam/acd/fr/legislation/legi17/lir-111-1-02112017.pdf) |
| A reform would raise the Art. 111 ceiling to **900 EUR from 2028** | Not used | To be confirmed by a tax adviser | One sponsored press article only. Bill 8676 is the single tax class bill ([government amendments](https://wdocs-pub.chd.lu/docs/Dossiers_parlementaires/8676/20260717_Depot.pdf)); nothing found ties it to this figure, and it was not voted when this was written |
| An employee's **personal contributions to the employer's supplementary pension scheme** (law of 8 June 1999, **Art. 110 no. 3 LIR**) are deductible up to **1,200 EUR a year** | Deduction rules, rule 4 (no scenario uses it) | Confirmed | Tax administration, [cotisations et primes d'assurance](https://impotsdirects.public.lu/fr/az/c/cotis_prim.html); [guichet.public.lu](https://guichet.public.lu/en/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/regimes-complementaire-pension-resident.html); [circular of 30 January 2002](https://impotsdirects.public.lu/dam-assets/fr/legislation/legi02/Circulaire_du_30_janvier_2002.pdf) |
| The **employer's contributions** to a supplementary pension scheme are taxed by a **20% flat-rate withholding at the employer's charge** | README (the plan has no employer contribution) | Confirmed | [guichet.public.lu, withholding tax on supplementary pension schemes](https://guichet.public.lu/en/entreprises/fiscalite/impots-benefices/imposition-salaires/versement-retenue-impot/retenue-impot-rcp.html); [tax administration, LRCPs](https://impotsdirects.public.lu/fr/echanges_electroniques/lrcps.html) |
| A further yearly tax of 0.9% on those contributions | Not used | To be confirmed by a tax adviser | One parliamentary document found by search |
| Deductions are claimed in the **tax return (modèle 100)**, or by an employee not otherwise assessed in the **annual adjustment (décompte annuel, modèle 163)** | Year-End Tax, tax certificate touchpoint; README | Confirmed | Tax administration's forms, for example [modèle 163 R F 2025](https://impotsdirects.public.lu/dam-assets/fr/formulaires/decompte_annuel/2025/163rf-25-100.pdf) and [the forms for employees](https://impotsdirects.public.lu/fr/salpens/formulaires.html) |
| The insurer issues a **yearly certificate** of the premiums paid | Issue tax certificate | To be confirmed by a tax adviser | The tax administration's [circular 111bis/1 of 11 December 2002](https://impotsdirects.public.lu/dam-assets/fr/legislation/legi02/Circulaire_du_11_decembre_2002.pdf) has a section on the certificate the provider issues; its current form and deadline were not found |

## Cross-border workers

| Fact | Used where | Mark | Source |
|---|---|---|---|
| A non-resident may ask to be **assimilated to a resident** (Art. 157ter LIR) when at least **90% of their worldwide income** is taxable in Luxembourg, or their income not taxable in Luxembourg is below **13,000 EUR** | Tax adviser review; the decision table Tax residence route sends every cross-border worker to a tax adviser | Confirmed | Tax administration, [assimilation](https://impotsdirects.public.lu/fr/az/a/assimil.html); [circular 157ter/1 of 21 March 2019](https://impotsdirects.public.lu/dam-assets/fr/legislation/legi19/2019-03-21-LIR-157ter-1du2132019.pdf); [guichet.public.lu](https://guichet.public.lu/en/citoyens/fiscalite/declaration-impot-decompte/activite-professionnelle/declaration-revenus/assimilation-resident.html) |
| A resident of **Belgium** needs **50%** of the household's professional income taxable in Luxembourg | README | Secondary | A payroll guide found by search |
| A non-resident deducts Art. 111bis premiums only after **opting for assimilation** | Ana's scenario | Confirmed | [guichet.public.lu](https://guichet.public.lu/fr/citoyens/fiscalite/declaration-impot-decompte/depenses-deductibles/contrat-prevoyance-resident.html) |
| How a French, Belgian or German resident's own country treats the contract | Not decided by the workflows | To be confirmed by a tax adviser | Each tax treaty and each country's law; the example leaves it to the tax adviser |

## Insurance and investment

| Fact | Used where | Mark | Source |
|---|---|---|---|
| The policyholder of an **individual life insurance contract** of more than six months may **cancel within 30 calendar days** from when they are told the contract is concluded, by letter; they then owe only the cover actually provided | Cooling-off period; Marc's scenario | Confirmed | Law of 27 July 1997 on the insurance contract, **Art. 100** and 100-1, [consolidated text of 25 November 2025 published by the Commissariat aux Assurances](https://www.caa.lu/uploads/documents/files/Loi_ContratAssurance_1997-07-27_coord_2025-11-25.pdf) |
| Every premium is **refunded in full**, the insurer bearing any loss in value during the 30 days | Redeem units and refund premium | A term of this fictional plan | Whether the law requires the full premium back for a unit-linked contract, or allows a refund at the units' value, is **to be confirmed by a lawyer** |
| The investment rules for **unit-linked life insurance** are those of the Commissariat aux Assurances' **circular letter 26/1**, which replaced circular letter 15/3 for contracts taken out from **1 February 2026** | Glossary; README | Confirmed (replacement); to be confirmed (transition) | [LC 26/1](https://www.caa.lu/uploads/documents/files/LC26-1_FR.pdf); [LC 15/3](https://www.caa.lu/uploads/documents/files/Circ15_3.pdf). Sources differ on the publication date (28 January or 1 February 2026); the treatment of contracts taken out before is to be confirmed |
| The **triangle of security**: the insurer, a **custodian bank** that holds the assets covering the policies apart from the insurer's own, and the Commissariat aux Assurances that supervises both | Custodian bank role; glossary | Secondary | Insurers' and advisers' explanations; the legal basis is the law of 7 December 2015 on the insurance sector |
| The policyholders' **super-privilege**: a first-ranking claim on the covering assets, ahead of every other creditor | Glossary | Secondary | Law of 7 December 2015, Art. 118, as cited by secondary sources; to be confirmed by a lawyer on the consolidated text |

## Distribution, due diligence and AI

| Fact | Used where | Mark | Source |
|---|---|---|---|
| Before an insurance contract is concluded, the distributor states the customer's **demands and needs** | Assess demands and needs | Confirmed | Insurance Distribution Directive (EU) 2016/97, [Art. 20](https://eur-lex.europa.eu/eli/dir/2016/97/oj) |
| An insurance-based investment product sold **with advice** needs a **suitability assessment**: knowledge and experience, financial situation including the ability to bear losses, objectives including risk tolerance | Questionnaire, Assess demands and needs, Risk profile | Confirmed (structure) | Directive 2016/97, [Art. 30](https://eur-lex.europa.eu/eli/dir/2016/97/oj); Delegated Regulation (EU) [2017/2359](https://eur-lex.europa.eu/eli/reg_del/2017/2359/oj), Art. 9. The exact wording of Art. 9 was not read |
| The suitability assessment asks for **sustainability preferences** | Questionnaire | Secondary | Delegated Regulation (EU) [2021/1257](https://eur-lex.europa.eu/eli/reg_del/2021/1257/oj), which amended 2017/2359; not re-read here |
| Each fund has a **key information document** with a **summary risk indicator from 1 to 7** | Propose investments, Check choice against profile | Secondary | PRIIPs Regulation (EU) [1286/2014](https://eur-lex.europa.eu/eli/reg/2014/1286/oj) and Delegated Regulation (EU) [2017/653](https://eur-lex.europa.eu/eli/reg_del/2017/653/oj); not re-read here |
| A **politically exposed person** needs enhanced due diligence: the **source of wealth and of funds** established, and **senior management's approval** of the relationship | Resolve compliance alert, Approve PEP relationship (four eyes) | Confirmed (source of wealth); to be confirmed (approval) | Law of 12 November 2004, Art. 3-2(4), [consolidated text](https://pfi.public.lu/dam-assets/pdf/blanchiment/legislations-et-recommandations/legislations-nationales/l-121104-blanchiment-jour-au-27072026.pdf); Directive (EU) [2015/849](https://eur-lex.europa.eu/eli/dir/2015/849/oj), Art. 20. The wording of the approval requirement was not read; the example asks for two approvers, one of them the head of compliance |
| A policy is reported under **CRS** to the countries of tax residence, and under **FATCA** for a US person, from a **self-certification** | Validate tax self-certification | Secondary | Directive 2014/107/EU ([DAC2](https://eur-lex.europa.eu/eli/dir/2014/107/oj)); the formats of tax identification numbers in the reference adapter are examples |
| Under the EU AI Act, AI systems for **risk assessment and pricing of natural persons in life and health insurance** are **high-risk** (Annex III, point 5(c)) | README | Secondary | Regulation (EU) [2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj), as read by several commentaries; see [docs/compliance/eu-ai-act.md](../../docs/compliance/eu-ai-act.md) |

## The scenarios' amounts

| Scenario | Premiums 2026 | Deductible under Art. 111bis for 2026 |
|---|---|---|
| Léa | 12 × 375 = 4,500 EUR | 4,500 EUR |
| Tom | 12 × 250 = 3,000 EUR (a top-up of 1,500 EUR proposed, not taken) | 3,000 EUR |
| Ana | 12 × 375 = 4,500 EUR, if she opts for assimilation | 4,500 EUR |
| Marc | 200 EUR, refunded when he cancels | none |
| Sara | 12 × 375 = 4,500 EUR | 4,500 EUR |
| Nina | none | none |
| Paul | 11 × 300 + (300 + 900 top-up) = 4,500 EUR | 4,500 EUR |
| Eva | 12 × 375 = 4,500 EUR | 4,500 EUR |
