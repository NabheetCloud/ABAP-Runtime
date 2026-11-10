---
title: Use released APIs (ABAP Cloud)
category: ABAP Cloud readiness
source: RAP Studio, with SAP's Cloudification Repository
---

# Use released APIs

ABAP Cloud code (RAP business objects, CDS views, classes) may only use objects that SAP releases for ABAP Cloud.
SAP's tables such as `KNA1`, `MARA` or `T001` are **not to be released**: on a real S/4HANA Cloud or ABAP Cloud
system the code does not compile. Each of them has a released successor, usually a CDS view of the virtual data
model, which this check names.

```abap
" not released
SELECT kunnr, name1 FROM kna1 INTO TABLE @DATA(lt_customers).

" released successor
SELECT Customer, CustomerName FROM I_Customer INTO TABLE @DATA(lt_customers).
```

```cds
// not released
define view entity ZI_MyCustomers as select from kna1 { ... }

// released successor
define view entity ZI_MyCustomers as select from I_Customer { ... }
```

Classic programs (reports, module pools, function groups) are "classic ABAP" and may use the tables; this check does
not look at them.

The list of objects and successors is SAP's [Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc)
(Apache-2.0), copied to `knowledge/sap/released-objects.json`. The released views exist in every RAP Studio system
(the SAP standard layer, `standard/s4hana`).
