# Print forms (SAP Adobe forms) — reference app

A billing document printed the SAP way, end to end:

| Object | What |
|---|---|
| `zbil_head`, `zbil_item` (tables, `data/`) | billing documents with their items (seed data) |
| `ZI_BillingDoc`, `ZI_BillingDocItem` (CDS) | the form's data: the root with the association `_Item` |
| `ZFDP_BILLINGDOC` (service definition) | the form data provider: `@ObjectModel.leadingEntity.name: 'ZI_BILLINGDOC'` |
| `zbilling_doc.form.json` | the layout: address window, items grouped by category with a calculated net value and subtotals, tax and totals as form variables, amount in words, SEPA payment QR code, terms as a text module in English and German, a DRAFT watermark |
| `zdelivery_conf.form.json` | an interactive form: fillable fields, a check box, a drop-down list and a signature field |
| `zcl_billing_output` | the output: ABAP Cloud APIs (form reader, data provider, `render_pdf`, print queue), the classic interface (`FP_JOB_OPEN`, generated function module, `FP_JOB_CLOSE`), an interactive form read back (`cl_fp` PDF object) and signed |

Try it: `rap form zbilling_doc BILLINGDOC=0090000001`, `rap run . zcl_billing_output`, `rap form check`.
Signing needs a key: `rap form key ZBILLING` (development, self-signed, in `.rap/signing`).
