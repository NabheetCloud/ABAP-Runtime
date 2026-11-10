# {{APP}} — RAP application (RAP Studio)

You are building an SAP RAP application in this folder. It runs on **RAP Studio**, an open runtime that executes
standard ABAP RAP sources without an SAP server (CDS → SQLite views, ABAP → JavaScript, OData V4, Fiori-like UI).
Write **standard ABAP for Cloud Development / RAP syntax** — the same sources must later deploy to SAP BTP ABAP
environment via abapGit. Do not write JavaScript, Node or other code for the backend.

The user sees this folder live: a preview of the app, a code editor and the database. Every file change re-activates
the app automatically. Data in `.rap/data.db` persists between runs — never delete it.

## Files (abapGit layout, all in `src/`, lower-case file names)

| Object | File | Content |
|---|---|---|
| Database table | `src/<ztable>.tabl.cds` | `define table ztable { key client : abap.clnt not null; key ... }` |
| CDS view entity | `src/<name>.ddls.asddls` | `define [root] view entity ...` |
| Abstract entity (action parameter) | `src/<name>.ddls.asddls` | `define abstract entity ...` |
| Metadata extension | `src/<name>.ddlx.asddlxs` | `@Metadata.layer: #CUSTOMER annotate entity ... with { ... }` |
| Behavior definition | `src/<name>.bdef.asbdef` | `managed implementation in class zbp_... unique; strict ( 2 ); ...` |
| Behavior pool | `src/zbp_<name>.clas.abap` + `src/zbp_<name>.clas.locals_imp.abap` | global class `FOR BEHAVIOR OF`, local handler classes |
| Service definition | `src/<zui_name>.srvd.srvdsrv` | `define service ZUI_... { expose ZC_X as X; }` |
| Access control | `src/<view>.dcls.asdcls` | `define role ... { grant select on ... where ...; }` |
| Unit tests | `src/<class>.clas.testclasses.abap` | local classes `FOR TESTING` |
| Local types / macros of a class | `src/<class>.clas.locals_def.abap`, `src/<class>.clas.macros.abap` | |
| Interface | `src/<zif_name>.intf.abap` | `INTERFACE zif_name PUBLIC. … ENDINTERFACE.` |
| Message class | `src/<zmsg>.msag.json` | `{ "001": "Customer &1 does not exist" }` used by `new_message( id = 'ZMSG' number = '001' ... )` |
| Console class | `src/zcl_<name>.clas.abap` | implements `if_oo_adt_classrun` (demo / test / data generation) |
| Seed data | `data/<ztable>.json` | JSON array of rows, column names as in the table, loaded once when the table is empty |
| Freestyle UI5 app (optional) | `webapp/<app>/index.html`, `webapp/<app>/view/*.view.xml`, `webapp/<app>/controller/*.js` | SAPUI5 app using the OData V4 service |

Use the Z namespace. Conventions: tables `z<name>_a`, interface/base views `ZR_<Name>`, projections `ZC_<Name>`,
reuse views `ZI_<Name>`, behavior pool `ZBP_R_<Name>`, service `ZUI_<NAME>`, handler classes `lhc_<alias>`.

## A transactional (CRUD) app needs all of these

1. Table(s) with a UUID key `key xyz_uuid : sysuuid_x16 not null;` plus admin fields
   (`created_by : abp_creation_user; created_at : abp_creation_tstmpl; last_changed_by : abp_lastchange_user;
   last_changed_at : abp_lastchange_tstmpl; local_last_changed_at : abp_locinst_lastchange_tstmpl;`).
2. Root view entity `ZR_X` (`define root view entity ... as select from table`), child entities via
   `composition [0..*] of ZR_Child as _Child` and `association to parent ZR_X as _Parent on $projection.ParentUUID = _Parent.ParentUUID`.
   Annotate admin fields with `@Semantics.user.createdBy: true`, `@Semantics.systemDateTime.createdAt: true`,
   `@Semantics.user.lastChangedBy: true`, `@Semantics.systemDateTime.lastChangedAt: true`,
   `@Semantics.systemDateTime.localInstanceLastChangedAt: true` — the runtime fills them.
3. Managed BDEF on `ZR_X` with `persistent table`, `lock master`, `authorization master ( instance )`,
   `etag master LocalLastChangedAt`, `create; update; delete;`, `field ( numbering : managed, readonly ) XyzUUID;`,
   `field ( readonly )` for calculated/admin fields, `field ( mandatory )`, an explicit `mapping for <table> { Element = column; }`.
   Children: `lock dependent by _Parent`, `authorization dependent by _Parent`, and on the parent `association _Child { create; }`.
4. Behavior pool with handlers for every determination, validation, action, `instance features`, `instance authorization`
   declared in the BDEF (activation fails otherwise).
5. Projection views `ZC_X` (`provider contract transactional_query as projection on ZR_X`, `@Metadata.allowExtensions: true`,
   children `_Child : redirected to composition child ZC_Child`, `_Parent : redirected to parent ZC_X`).
6. Projection BDEF (`projection; strict ( 2 ); define behavior for ZC_X alias X use etag { use create; use update; use delete; use action ...; use association _Child { create; } }`).
7. Metadata extensions with UI annotations (this is what renders the Fiori UI), service definition exposing the projections
   and any value-help views (`ZI_...`).

Read-only apps need only tables, views, metadata extension and service definition.

## Reuse what exists in the system

All apps in this studio form one system, like one SAP system: you can use the tables and CDS views of the other apps.
Before you create master data or reference data (employees, statuses, categories …; for products, customers,
suppliers, plants, currencies and units use the SAP standard layer below) search for it: `node {{RAP}} catalog <words>` (e.g. `catalog product`, `catalog supplier`).
The user's new app usually belongs next to apps they already built, so reuse instead of copying:
- Reference the other app's view (prefer a `ZI_…` view over its table) by name, exactly as if it were in this app:
  `association [0..1] to ZI_Product as _Product on $projection.ProductID = _Product.ProductID`, path fields such as
  `_Product.ProductName as ProductName`, and a value help `@Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_Product', element: 'ProductID' } }]`.
- Expose that view in your service (`expose ZI_Product as Product;`) so the value help works.
- Small lists (statuses, categories, a few dozen customers) should be drop-downs: if the reused view has no
  `@ObjectModel.resultSet.sizeCategory: #XS`, define your own small `ZI_…` view `as select from` the other app's view
  or table with that annotation and a text element.
- The data stays with the app that owns it and is read live. Never write to another app's tables, never copy their
  rows into seed data, and do not create a table that duplicates one that exists (the check warns about it).
- Only create new master data when nothing suitable exists.

## The SAP standard layer (S/4HANA organisation, configuration, master data and business documents)

Every system has SAP's standard objects, like a fresh S/4HANA client with best-practice data. Use them by name, the
same way as another app's views, before you create anything of your own: never create your own customer, supplier,
product, business partner, company code, plant, currency, country, unit, G/L account, cost center or profit center.
- RAP and ABAP Cloud code use the **released CDS views** (as on a real S/4HANA system, so the code stays portable):
  - organisation: `I_CompanyCode`, `I_Plant`, `I_StorageLocation`, `I_ValuationArea`, `I_SalesOrganization`(+`Text`),
    `I_DistributionChannel`(+`Text`), `I_Division`(+`Text`), `I_SalesArea`, `I_PurchasingOrganization`,
    `I_PurchasingGroup`, `I_ControllingArea`
  - configuration: `I_Country`/`I_CountryText`, `I_Region`/`I_RegionText`, `I_Currency`/`I_CurrencyText`,
    `I_ExchangeRateRawData`, `I_ExchangeRateType`, `I_UnitOfMeasure`/`I_UnitOfMeasureText`, `I_Language`,
    `I_PaymentTerms`/`I_PaymentTermsText`, `I_IncotermsClassification`(+`Text`), `I_ShippingCondition`(+`Text`),
    `I_ProductType`/`I_ProductTypeText`, `I_ProductGroup_2`/`I_ProductGroupText_2`, `I_MRPType`, `I_ChartOfAccounts`,
    `I_FiscalYearVariant`, `I_CustomerAccountGroup`, `I_SupplierAccountGroup`, `I_BusinessPartnerGrouping`, `I_GLAccountGroup`
  - master data: `I_BusinessPartner`, `I_BusinessPartnerRole`, `I_Address_2`, `I_Customer`, `I_CustomerCompany`,
    `I_CustomerSalesArea`, `I_Supplier`, `I_SupplierCompany`, `I_SupplierPurchasingOrg`, `I_Product`,
    `I_ProductDescription`, `I_ProductText`, `I_ProductUnitsOfMeasure`, `I_ProductPlantBasic`,
    `I_ProductStorageLocationBasic`, `I_ProductValuationBasic`, `I_ProductSalesDelivery`, `I_GLAccountInChartOfAccounts`,
    `I_GLAccountText`, `I_GLAccountInCompanyCode`, `I_CostCenter`/`I_CostCenterText`, `I_ProfitCenter`/`I_ProfitCenterText`, `I_Bank_2`
  - sales: `I_SalesOrder`, `I_SalesOrderItem`, `I_SalesOrderScheduleLine`, `I_SalesOrderPartner`,
    `I_SalesOrderItemPricingElement`, `I_SalesDocument`(+`Item`), `I_DeliveryDocument`(+`Item`), `I_BillingDocument`(+`Item`),
    `I_BillingDocumentItemPrcgElmnt`, `I_BillingDocumentItemBasic`, `I_SDDocumentProcessFlow` (order → delivery → goods issue → billing),
    `I_SalesDocumentFlow`, `I_OutboundDelivery`(+`Item`), `I_PricingConditionRecord`
  - procurement: `I_PurchaseRequisitionItem`, `I_PurchaseOrderAPI01`, `I_PurchaseOrderItemAPI01`,
    `I_PurchaseOrderScheduleLineAPI01`, `I_PurOrdAccountAssignmentAPI01`, `I_PurchaseOrderHistoryAPI01` (GR / IR),
    `I_SupplierInvoiceAPI01`, `I_SuplrInvcItemPurOrdRefAPI01`, `I_PurchasingInfoRecordApi01`, `I_PurchasingSourceList`;
    also `I_PurchaseOrder`(+`Item`, `ScheduleLine` with `ScheduleLineOpenQuantity`, `History`), `I_PurchaseRequisition`,
    `I_PurchasingInfoRecord`, `I_SupplierInvoice`(+`Item`)
  - inventory: `I_MaterialDocumentHeader_2`, `I_MaterialDocumentItem_2`, `I_MaterialStock_2` (stock from the material
    documents), `I_StockQuantityCurrentValue_2`, `I_StockQuantityCurrentValue`, `I_Batch`, `I_Reservation`, `I_ReservationDocumentItem`,
    `I_MaterialDocumentHeader`, `I_MaterialDocumentItem`, `I_ProductStorageLocation`, `I_ProductValuation`, `I_ProductSales`,
    `I_ProductUnitOfMeasure`
  - accounting: `I_JournalEntry`, `I_JournalEntryItem` (universal journal, ledgers 0L and 2L), `I_GLAccountLineItem`,
    `I_OperationalAcctgDocItem`, `I_GLAcctBalanceCube`, `I_Ledger`, `I_Segment`, `I_InternalOrder`, `I_FixedAsset`,
    `I_FixedAssetAssgmt`, `I_AssetClass`, `I_FiscalYearPeriodForVariant`, `I_Asset`, `I_AssetDepreciationArea`
  - production, maintenance, quality, projects: `I_PlannedOrder`, `I_ManufacturingOrder`(+`Item`, `Operation`),
    `I_MfgOrderConfirmation`, `I_BillOfMaterial`, `I_BillOfMaterialItemBasic`, `I_MaterialBOMLink`, `I_WorkCenter`,
    `I_ProductionVersion`, `I_Equipment`, `I_FunctionalLocation`, `I_MaintenanceNotification`, `I_MaintenanceOrder`,
    `I_MaintenancePlan`, `I_MaintenanceItem`, `I_InspectionLot`, `I_InspectionCharacteristic`, `I_InspectionResult`,
    `I_InspLotUsageDecision`, `I_Project`, `I_WBSElement`; `I_ProductionOrder`(+`Item`, `Operation`, `Component`),
    `I_Routing`(+`Operation`), `I_BillOfMaterialItem`, `I_MaintenanceOrderOperation`, `I_MeasuringPoint`, `I_MeasurementDocument`,
    `I_QualityNotification`(+`Item`, `Task`), `I_InspectionLotUsageDecision`, `I_Network`, `I_NetworkActivity`, `I_ProjectElement`,
    `I_ProjectStatus`
  - warehouse and transportation: `I_EWMStorageBin`, `I_EWMWarehouseTask`, `I_FreightOrder`; and `I_ChangeDocument`(+`Item`), `I_User`, `I_BusinessPartnerBank`
  `node {{RAP}} catalog i_product` (or any word) shows a view's fields. Text views have `Language` as key: filter
  `Language = $session.system_language` or `'E'`. Example: `association [0..1] to I_Customer as _Customer on
  $projection.Customer = _Customer.Customer` with `_Customer.CustomerName`, and the value help
  `@Consumption.valueHelpDefinition: [{ entity: { name: 'I_Customer', element: 'Customer' } }]` (expose I_Customer in the service).
- Classic programs (reports, module pools) may also read SAP's tables directly: `t001` (company codes), `t001w`
  (plants), `t001l`, `tvko`, `t024e`, `t024`, `tcurc`, `tcurr`, `t005`, `t006`, `but000`, `but100`, `adrc`, `kna1`,
  `knb1`, `knvv`, `lfa1`, `lfb1`, `lfm1`, `mara`, `makt`, `marc`, `mard` (stock per storage location), `mbew` (prices),
  `mvke`, `marm`, `ska1`, `skat`, `skb1`, `csks`, `cepc`, `bnka` (field names as in SAP: `matnr`, `kunnr`, `werks` …),
  and the documents' tables: `vbak`/`vbap`/`vbep`/`vbpa`/`vbkd`/`vbfa`, `likp`/`lips`, `vbrk`/`vbrp`, `prcd_elements`,
  `eban`, `ekko`/`ekpo`/`eket`/`ekkn`/`ekbe`, `rbkp`/`rseg`, `matdoc` (and the compatibility views `mkpf`, `mseg`),
  `mchb`, `resb`, `ikpf`/`iseg`, `bkpf`, `bseg`, `bset`, `acdoca`, `aufk`/`afko`/`afpo`/`afvc`/`afru`, `stko`/`stpo`,
  `plko`/`plpo`, `crhd`, `equi`, `iflot`, `qmel`, `qals`/`qamv`/`qamr`/`qave`, `anla`/`anlz`, `proj`/`prps`, `cdhdr`/`cdpos`,
  `coep`, `bpge`/`bpja`, `ihpa`, `jcds`, `pa0001`/`pa0006`/`pa0007`/`pa0105`, the compatibility views `bsid`/`bsad`,
  `bsik`/`bsak`, `bsis`/`bsas`, `glpca`, `cosp`/`coss`, `anek`/`anep`/`anlc`, and EWM/TM tables with their namespace
  (`/scwm/lagp` bins, `/scwm/quan` stock, `/scwm/huhdr`/`/scwm/huitm`, `/scwm/who`, `/scwm/ordim_o`/`/scwm/ordim_c` warehouse
  tasks, `/scwm/prdo`/`/scwm/prdi`, `/scmtms/d_torrot`/`d_torite`/`d_torstp` freight orders, `/scmtms/d_tccrot` charges)
  … — about 340 tables; `node {{RAP}} catalog <word>` lists them with their fields.
- The data (read-only for apps): company codes 1010 (Germany, EUR), 1710 (USA, USD), 4110 (India, INR), each with a
  plant (1010 Hamburg, 1710 Palo Alto, 4110 Pune), storage locations `<cc>A`, `<cc>B`, `<cc>Q`, sales organization,
  purchasing organization and valuation area of the same number; distribution channels 10/20/30, divisions 00/10/20,
  purchasing groups 001–003, controlling area A000, chart of accounts YCOA; 10 customers (`0010100001`…,
  `0017100001`…, `0041100001`…), 7 suppliers (`0010300001`…, `0017300001`…, `0041300001`…), 15 products (laptops TG11/TG12,
  monitors TG13/TG14, accessories TG15–TG18, FG126, SG23, RM12, RM13, OS01, PK01, service SV01) with plant, stock,
  valuation and sales data; currencies, exchange rates (type M), countries, regions, units, payment terms, Incoterms.
  Business documents of 2026 that follow each other: 12 sales orders (`0000001001`…, plus 3 service contracts) with deliveries (`0080000001`…),
  goods issues, billing documents (`0090000001`…), journal entries and customer payments; purchase requisitions
  (`0010000001`…), purchase orders (`4500000001`…) with goods receipts (material documents `4900000001`…), supplier
  invoices (`5105600001`…) and payments; production orders (`000001000001`…) with confirmations and component
  issues; maintenance notifications and orders, inspection lots, fixed assets, projects with networks and budgets,
  CO line items, HR infotypes, change documents, users; EWM warehouse tasks and TM freight orders for the deliveries.
  Every journal entry balances; the stock (`mard`, `I_MaterialStock_2`) is what the material documents leave.
- Your app's own documents (orders, requests, bookings …) reference these keys (`Customer`, `Product`, `Plant`,
  `CompanyCode`, `Currency`, `UnitOfMeasure`) instead of copying names or prices into its tables.

## UI annotations the runtime renders

`@UI.headerInfo: { typeName, typeNamePlural, title: { value: 'Field' }, description: { value: 'Field' } }` (entity level, above `annotate entity`),
`@UI.presentationVariant: [{ sortOrder: [{ by: 'Field', direction: #DESC }] }]`,
`@UI.facet: [ { id, purpose: #STANDARD, type: #COLLECTION | #IDENTIFICATION_REFERENCE | #FIELDGROUP_REFERENCE | #LINEITEM_REFERENCE, label, position, parentId, targetQualifier, targetElement: '_Child' } ]` (on the first element),
`@UI.lineItem: [{ position, importance, label, criticality: 'CritField' }, { type: #FOR_ACTION, dataAction: 'actionName', label }]`,
`@UI.identification` (same shape, actions appear as object page buttons), `@UI.fieldGroup: [{ qualifier, position }]`,
`@UI.selectionField: [{ position }]`, `@UI.hidden: true`, `@EndUserText.label`, `@ObjectModel.text.element: ['NameField']`,
`@Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_X', element: 'Key' } }]` (expose `ZI_X` in the service),
`@Search.searchable: true` + `@Search.defaultSearchElement: true`.
A drop-down instead of a value-help dialog: put `@ObjectModel.resultSet.sizeCategory: #XS` on the value help view `ZI_X`
(entity level) and give its key a text with `@ObjectModel.text.element: ['XText']`. Both the built-in UI and SAP Fiori elements
(`Common.ValueListWithFixedValues`) then render a drop-down, in the filter bar and in edit mode.
Criticality values: 1 red, 2 yellow, 3 green (compute them with `case` in the projection view).

## Supported / not supported

Supported: everything in `{{DOCS}}/LANGUAGE-COVERAGE.md`. Managed BOs, determinations on modify/save, validations,
actions (instance, static, internal, with `parameter` abstract entity and `result [1] $self`), instance features,
instance/global authorization, early numbering, EML (READ/MODIFY/COMMIT ENTITIES, `IN LOCAL MODE`, `BY \_assoc`, `%cid_ref`),
ABAP SQL incl. FOR ALL ENTRIES, CDS joins/associations/path expressions/case/cast/functions.

Draft is supported and recommended for transactional apps (SAP Fiori elements uses the draft protocol):
`with draft;` in the header, `draft table z<name>_d` per entity (define it as a table with the entity's element names in lower case
plus `"%admin" : include sych_bdl_draft_admin_inc;`), `total etag LastChangedAt` on the root, and on the root
`draft action Edit; draft action Activate optimized; draft action Discard; draft action Resume; draft determine action Prepare { validation ...; }`.
In the projection BDEF: `use draft;` and `use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;`.
Validations run on Prepare/Activate, determinations on modify run while editing the draft, determinations on save run on activation.
Side effects are supported: `side effects { field A affects field B; field C affects field _Parent.D; action x affects $self; }`.

Analytics: annotate measures with `@Aggregation.default: #SUM` and add an entity-level
`@UI.chart: [{ qualifier: 'X', title: '...', chartType: #COLUMN, dimensions: ['Dim'], measures: ['Measure'] }]` (use a separate
read-only `select from` view for analytics).

Late numbering and unmanaged save are supported (reference: `{{ORDERS}}`, a sales order with items):
- `late numbering` on an entity: drafts and new instances get a preliminary key; implement `adjust_numbers` in the saver
  (`CLASS lsc_x DEFINITION INHERITING FROM cl_abap_behavior_saver` with `METHODS adjust_numbers REDEFINITION.`) and fill the
  final key fields in `mapped-<entity>` (each row already carries `%pid`, `%tmp` and the parent's final key).
- `managed with unmanaged save` (or `with unmanaged save` on an entity): the runtime does not write the persistent table;
  implement `save_modified` and write `create-<entity>`, `update-<entity>` and `delete-<entity>` yourself, e.g.
  `INSERT ztab FROM TABLE @( CORRESPONDING #( create-x MAPPING FROM ENTITY ) ).` and
  `UPDATE ztab FROM @( CORRESPONDING #( u MAPPING FROM ENTITY USING CONTROL ) )`. `with additional save` keeps the managed
  write and calls `save_modified` in addition.

Drafts are locked per user: other users see the active data with "locked by", cannot edit or run actions until the draft
is activated or discarded, or the lock expires (15 minutes). Test as several users with the `x-rap-user: ALICE` header.

Also supported (use them when the request needs them; short syntax reminders):
- Optimistic locking: `etag master LocalLastChangedAt` (+ `total etag LastChangedAt` on draft roots); changed-in-between gives HTTP 412.
- Custom entity: `@ObjectModel.query.implementedBy: 'ABAP:ZCL_X'` + `define custom entity ...`; the class implements
  `if_rap_query_provider~select` (`io_request->get_filter( )->get_as_sql_string( )` / `get_as_ranges( )`, `get_paging( )`,
  `get_sort_elements( )`, `is_data_requested( )`, `is_total_numb_of_rec_requested( )`; `io_response->set_data( )`,
  `set_total_number_of_records( )`); `SELECT ... WHERE (lv_where) ORDER BY (lv_order)` works.
- Unmanaged BO (legacy code owns the buffer): `unmanaged implementation in class ... unique;` with handler methods
  `FOR MODIFY ... FOR CREATE / UPDATE / DELETE`, `FOR READ`, `FOR LOCK`, and a saver with `save` (+ `finalize`,
  `check_before_save`, `cleanup`) REDEFINITION. No draft for unmanaged BOs.
- Business events: `event Name [parameter ZD_Param];` in the BDEF, `RAISE ENTITY EVENT zr_x~Name FROM VALUE #( ... )` in the
  saver (`save_modified` / `save` only), consumers: `CLASS zcl_x DEFINITION ... FOR EVENTS OF zr_x` with local
  `lhe_x INHERITING FROM cl_abap_behavior_event_handler` and `METHODS on_x FOR ENTITY EVENT rows FOR Alias~Name`. Log: `node {{RAP}} events .`
- Access control: `src/<view>.dcls.asdcls` with `define role ... { grant select on ZC_X where ( Field ) = aspect pfcg_auth( ZAUTHOBJ, ZFIELD, ACTVT = '03' ) or CreatedBy = aspect user; }`
  (also `inheriting conditions from entity ZR_X`); `AUTHORITY-CHECK OBJECT 'ZAUTHOBJ' ID 'ACTVT' FIELD '02' ...` in
  authorization handlers. Users and roles: `node {{RAP}} user <apps-dir> <name> --password ... --role R`, `node {{RAP}} role <apps-dir> R ZAUTHOBJ ACTVT=03 ZFIELD=DE`.
  Without users everything is allowed (development). `$session.user` works in CDS.
- CDS parameters (`with parameters p_x : abap.dats`, `$parameters.p_x`, `@Environment.systemField: #SYSTEM_DATE` defaults;
  OData `Set(p_x=...)/Set`), table functions with an AMDP method (`BY DATABASE FUNCTION ... RETURN SELECT ...;`),
  hierarchies (`define hierarchy ... as parent child hierarchy( source ... child to parent association _Parent start where ... siblings order by ... )` with `$node.hierarchy_level` etc.).
- Attachments: a `abap.rawstring(0)` field with `@Semantics.largeObject: { mimeType: 'MimeType', fileName: 'FileName', contentDispositionPreference: #ATTACHMENT }`
  plus `@Semantics.mimeType: true` on the MIME type field: Fiori elements shows upload / download.
- Change documents: `changedocuments master ( ZOBJECT )` on the root, `changedocuments dependent by _Parent` on children.
- Collaborative draft: `with collaborative draft;` instead of `with draft;` (several users edit one draft).
- Behavior extensions: a separate `extension implementation in class zbp_x unique; extend behavior for Alias { ... }` file.
- Released APIs for ABAP Cloud code: number ranges (`cl_numberrange_runtime=>number_get( nr_range_nr = '01' object = 'Z...' )`,
  e.g. in an early numbering handler), application logs (`cl_bali_log` + `cl_bali_log_db=>get_instance( )->save_log( )`,
  shown under Logs), hashing (`cl_abap_message_digest`), base64 (`cl_web_http_utility`), code pages (`cl_abap_conv_codepage`),
  the HTTP client (`cl_web_http_client_manager=>create_by_http_destination( cl_http_destination_provider=>create_by_url( ... ) )`;
  named destinations live in the app's `.rap/destinations.json`, never in the sources) and e-mail (`cl_bcs_mail_message`; mails
  go to the app's local outbox, they are not delivered).
- Background processing: `cl_bgmc_process_factory=>get_default( )->create( )->set_operation( NEW zcl_op( ... ) )->save_for_execution( )`
  (a class with `if_bgmc_op_single`) runs after the commit. Application jobs: a job catalog entry `src/zjc_<name>.sajc.json`
  (`{ "formatVersion": "1", "header": { "description": "...", "originalLanguage": "en" }, "generalInformation": { "className": "ZCL_..." } }`),
  a template `src/zjt_<name>.sajt.json` (`"generalInformation": { "catalogName": "ZJC_..." }`), the class implements
  `if_apj_dt_exec_object` and `if_apj_rt_exec_object`; schedule with `cl_apj_rt_api=>schedule_job( )`, check with
  `node {{RAP}} appjobs . --run` (runs due jobs and lists them).
- ABAP Unit: test classes in `src/<class>.clas.testclasses.abap` (`FOR TESTING`, `cl_abap_unit_assert`,
  `cl_osql_test_environment` / `cl_cds_test_environment`, `TEST-SEAM` / `TEST-INJECTION`); run `node {{RAP}} test .`.
- ABAP: dynamic EML (`MODIFY / READ ENTITIES OPERATIONS`), RTTS (`cl_abap_typedescr`, `cl_abap_structdescr`), `SHIFT`, `CONVERT`,
  `CALL TRANSFORMATION id`, `/ui2/cl_json`, resumable exceptions, `CLEANUP`.

- Tree table: annotate the hierarchy's source entity with `@OData.hierarchy.recursiveHierarchy: [{ entity.name: 'ZI_X_Hier' }]`
  (it needs its `association to ... as _Parent`); the Fiori elements generator then uses a TreeTable.
- Transformations: XSLT programs and simple transformations in `src/<name>.xslt.source.xml`, used with `CALL TRANSFORMATION`.
- ABAP SQL `WITH +cte AS ( ... )` and path expressions `\_assoc-field`; data references (`REF #( )`, `->*`) behave as in ABAP.

## Classic ABAP programs (reports, module pools, function groups)

Besides RAP, an app can hold classic programs. They run on a second engine (open-abap) against the same database, so
a report can read and change this app's tables. Use them only when the user asks for a report, a selection screen,
a list, a module pool / dynpro transaction or a function module.
- Report: `src/z<name>.prog.abap` (`REPORT z<name>.`, `PARAMETERS`, `SELECT-OPTIONS`, `START-OF-SELECTION`, `WRITE`,
  `cl_salv_table` ALV) plus `src/z<name>.prog.xml` (abapGit PROG: `<SUBC>1</SUBC>`, the title as TPOOL entry ID `R`,
  selection texts as ID `S`).
- Module pool: `PROGRAM z<name>.` with `MODULE ... OUTPUT/INPUT`, `src/z<name>.prog.xml` with `<SUBC>M</SUBC>`, its
  dynpros (`DYNPROS`: fields of type TEXT, TEMPLATE for input/output bound to global variables, OKCODE) and GUI status
  (`CUA`: functions, `SET PF-STATUS`), one flow logic file per screen `src/z<name>.prog.screen_0100.abap`
  (`PROCESS BEFORE OUTPUT. MODULE ... PROCESS AFTER INPUT. MODULE ...`), and a transaction `src/z<tcode>.tran.xml`
  (TSTC: TCODE, PGMNA, DYPNO). Database changes are committed at the end of each dialog step.
- Lock objects: `src/e<name>.enqu.xml` (abapGit ENQU); `CALL FUNCTION 'ENQUEUE_E<NAME>'` / `'DEQUEUE_E<NAME>'` with the
  key fields, `EXCEPTIONS foreign_lock = 1` (sy-msgv1 = the user holding the lock). Locks belong to the user's session.
- Function groups: one file per function module, `src/z<group>.fugr.<function>.abap`, with SAP's interface comment
  block (`*"  IMPORTING` / `EXPORTING` / `CHANGING` / `TABLES` / `EXCEPTIONS`, `VALUE(...)` or `REFERENCE(...) TYPE ...`);
  the group XML, TOP include and main program are generated when they are missing. Global data goes in
  `src/z<group>.fugr.l<group>top.abap`, local classes (not FORM routines) in `src/z<group>.fugr.l<group>f01.abap`. Function modules can be
  called with `CALL FUNCTION` from reports and also from classes and RAP handlers (`IN UPDATE TASK` runs at `COMMIT WORK`).
  Classes can also start a report (`SUBMIT zrep WITH p = v EXPORTING LIST TO MEMORY AND RETURN`, then `LIST_FROM_MEMORY` /
  `LIST_TO_ASCI`) and a transaction with batch input (`CALL TRANSACTION 'ZTC' USING bdc_tab MODE 'N' MESSAGES INTO msgs`).
- Classic DDIC objects (`.dtel.xml`, `.doma.xml` with fixed values, `.ttyp.xml`) are allowed; tables stay `.tabl.cds`.
- Classic programs can read tables of other apps in the system by name (`rap catalog` lists them); the rows stay with
  the owner app and are read-only here. Do not copy such a table into this app.
- Application logs: `cl_bali_log`, `cl_bali_header_setter`, `cl_bali_free_text_setter` / message setters, saved with
  `cl_bali_log_db=>get_instance( )->save_log( )`; the user sees them under Logs.
- Background jobs: `JOB_OPEN` (EXPORTING jobname, IMPORTING jobcount TYPE btcjobcnt), `JOB_SUBMIT` (jobcount, jobname,
  report, optional variant), `JOB_CLOSE` (strtimmed = 'X', or sdlstrtdt/sdlstrttm, prdmins for periodic jobs). The
  scheduler runs the report without a screen and keeps its list as spool (Jobs page). Users can also schedule any
  report from its selection screen ("Run in background").
- Print forms: see "Print forms (SAP Adobe forms)" below; a classic program calls them with `FP_JOB_OPEN`,
  `FP_FUNCTION_MODULE_NAME`, `CALL FUNCTION fm_name`, `FP_JOB_CLOSE` or `zcl_rap_form=>render( )` / `print( )`.
- The open-abap standard classes are available (`cl_abap_*` RTTS, `cl_salv_table` ALV, XCO `xco_cp=>...`).
  Behavior pools and RAP handler classes cannot be called from classic programs; use EML only in RAP code.
- Reference: `{{CLASSIC}}` is a complete, working set of classic objects: reports (`zcflight_report`, ALV-free
  list), a module pool with its screen XML, flow logic, GUI status and transaction (`zcflight_maint`, `zcfl.tran.xml`),
  a lock object (`ezcflight.enqu.xml`), a function group from one source file (`zcfl.fugr.z_cfl_flights.abap`),
  data element / domain / table type, an application log and a background job (`zcflight_batch`) and a print form
  (`zcfl_flight_list.form.json`, `zcflight_print`). Copy its patterns, especially the module pool XML.

### Run and test classic programs

`node {{RAP}} check .` does not compile classic programs. Compile them with `node {{RAP}} gui . --build-only`
and fix every error. Then run what you built, from this folder, and check the output (one command per call):
- `node {{RAP}} programs` lists the programs and transaction codes.
- `node {{RAP}} functions` lists the function modules with their interface; `node {{RAP}} fm Z_FUNCTION IV_X=value`
  calls one (like SE37: structures and tables as JSON, e.g. `IT_ROWS='[{"FIELD": "x"}]'`) and prints sy-subrc,
  the exception raised and the export, changing and tables parameters. The user tests them under Functions.
- `node {{RAP}} program ZREPORT P_CARR=LH S_DATE-LOW=20260101` runs a report with selection values (parameters
  `NAME=value`, select-options `NAME-LOW` / `NAME-HIGH`, checkboxes `NAME=X`, dates `2026-11-05` or `05.11.2026`,
  times `02:00`) and prints the list and the message.
- `node {{RAP}} transaction ZTCODE FIELD=value --step SHOW --step SAVE FIELD=value` starts a transaction, types the
  fields and presses the function codes in order; it prints the screen fields and message after every step.
  Changes are saved to the database, so set test values back afterwards.
- `node {{RAP}} job schedule ZREPORT P_CARR=LH` runs a report as background job and prints its spool
  (`--at 2026-11-05T22:00:00Z`, `--every 60` for later or periodic jobs, `--no-wait`); `node {{RAP}} jobs`,
  `node {{RAP}} job <number>`, `node {{RAP}} job cancel <number>`.
- `node {{RAP}} logs` / `node {{RAP}} log <handle>` show application logs.
- `node {{RAP}} form ZFORM KEY=value` / `--data '{…}'` renders a print form and prints the text of its pages (see
  "Print forms"); `node {{RAP}} outputs` lists printed forms, `node {{RAP}} output delete <number>` removes one
  (delete the test prints you made); `node {{RAP}} job delete <number>` removes a job.
- `node {{RAP}} table ztable FIELD=value --top 20` shows table rows (`*` as wildcard); without a name, the tables.
When the user asks in the chat to run, show, schedule or print something ("run the report for LH", "schedule it
every night", "print the invoice for order 4711"), do it with these commands and reply with the result. The user
also runs everything in the preview under "Classic ABAP programs" (Programs, Jobs, Logs, Output, Forms, Tables).

## Print forms (SAP Adobe forms)

When the user asks for a print form, an Adobe form, a PDF document (invoice, delivery note, order confirmation,
certificate, label), an interactive / fillable form or a signed PDF, read `{{KNOWLEDGE}}/forms.md` first: it has the
layout syntax, the expressions, the ABAP APIs and the workflow. The working reference app is `{{FORMS}}` (copy it).

**Two kinds of layout — pick one:**
- **Adobe XDP layout (SAP Forms Service by Adobe, the SAP way)** — when the user asks for an *Adobe form*, an *XDP*,
  *LiveCycle*, or code "like in SAP" / to move to SAP later, or gives you an `.xdp`. The layout is `src/<form>.xdp`
  (XFA XML) with the form object `src/<form>.form.json` `{ "title", "layout": "<form>.xdp", "dataProvider" }`;
  RAP Studio renders it natively like Adobe Document Services, and the ABAP is SAP's (`cl_fp_form_reader`,
  `cl_fp_fdp_services=>…->read_to_xml_v2( )`, `cl_fp_ads_util=>render_pdf( )` / `render_4_pq( )`,
  `cl_print_queue_utils`). Start with `node {{RAP}} form xdp <FORM> --fdp <SRVD> --title "…"` (a starter XDP from the
  data provider), then refine the XDP; a user's own file: `node {{RAP}} form add <file.xdp> --fdp <SRVD>`. Read the
  section "Adobe forms with XDP layouts" of the forms knowledge (bindings `$.Alias.Element`, tables, pictures) and
  copy `{{ROOT}}/examples/adobe-forms` (SAP's cinema sample, running unchanged).
- **RAP Studio layout** (`src/<form>.form.json` with `"content"`) — everything else, and fillable / signed PDFs:
- Data: a form data provider = a service definition with `@ObjectModel.leadingEntity.name: 'ZI_<ROOT>'` exposing the
  root view (with associations to its children) and the children. The form's fields are the root's element names in
  lower case; children are tables under their association name (`_item`).
- Layout: `src/z<form>.form.json` with `"dataProvider"`, realistic `"sample"` data in the same shape, master page
  (`firstHeader`, `header`, `footer` with `{page}` / `{pages}`), tables with totals / groups, `variables` for
  calculations (`Sum(_item.netvalue)`, row by row `Sum(_item.qty * _item.price)`), `if` conditions, text modules per
  language, barcodes (QR, Data Matrix, PDF417, Aztec, Code 128 / 39 / 93, GS1-128, EAN / UPC, ITF, Codabar), images,
  fillable `input` fields (with `calc` for calculated ones) and signature fields; TrueType `fonts` for non-Latin
  scripts. Archiving: `"pdfa": true` or `iv_pdfa` / `outputparams-pdftype = 'A'`; passwords and permissions:
  `iv_password` / `iv_owner_password` / `iv_permissions` of `zcl_rap_form` (AES-256).
- Output: ABAP Cloud `cl_fp_form_reader` + `cl_fp_fdp_services` + `cl_fp_ads_util=>render_pdf` +
  `cl_print_queue_utils`; classic `FP_JOB_OPEN` / `FP_FUNCTION_MODULE_NAME` / `CALL FUNCTION fm_name` /
  `FP_JOB_CLOSE`; interactive forms and signatures with `cl_fp=>get_reference( )->create_pdf_object( )`. Put the
  output into a console class (`if_oo_adt_classrun`) so you and the user can run it.
- Verify: `node {{RAP}} check .` (it checks the layouts too), `node {{RAP}} form check` until it reports no findings,
  `node {{RAP}} form ZFORM KEY=value` for a real record — read the page text and fix what is wrong (missing values,
  `[object Object]`, wrong totals, wrong formats) — and `node {{RAP}} run . zcl_<output_class>`. Signing needs a key:
  `node {{RAP}} form key ZKEY`. An Adobe LiveCycle Designer layout (.xdp) the user gives you: `node {{RAP}} form import <file.xdp>`
  (its JavaScript / FormCalc scripts become expressions; read the warnings it prints and check each converted one).
- Tell the user they can edit the layout visually in the studio (open the `.form.json` file: Design view with an
  object library, drag and drop, data view and properties) and see the live PDF (Preview view) with a choice of the
  record and the locale. Keep the layout in the documented JSON format so the designer and you stay in sync.

## Debugging: runtime errors, debugger, SQL trace

- `node {{RAP}} dumps .` lists runtime errors (uncaught exceptions of OData requests, console runs, jobs, like ST22);
  `node {{RAP}} dump . <nr>` shows the exception, the ABAP call stack and the source around the failing line.
- `node {{RAP}} debug . zcl_<class> --break src/zcl_<class>.clas.abap:<line> [--break …]` runs a console class in
  the debugger and prints the variables and the call stack at every stop.
- `node {{RAP}} run . zcl_<class> --trace` adds the SQL trace (statements, rows, time, the ABAP method).
- `node {{RAP}} system .` lists the runtime's records (application jobs, logs, background processes, mail outbox,
  number ranges, output queue); `node {{RAP}} system . mail_outbox` shows one of them.
When the user asks why something fails, look at the runtime errors first, then debug.

## OData V2

Every service is also available as OData V2 (like a SEGW / Gateway service) at
`/a/{{APP}}/sap/opu/odata/sap/<SERVICE>/` (`$metadata` with sap: annotations, JSON `{ d: ... }`, `$batch`,
function imports for actions and draft: `<Set>Edit`, `<Set>Activate`, `<Set>Prepare`, `<Set>Discard`). Use it when
the user asks for OData V2 or an SAPUI5 app with `sap.ui.model.odata.v2.ODataModel`; nothing extra is needed in the
sources.

## Every other object kind

`{{KNOWLEDGE}}/objects.md` lists **every object kind the runtime supports** (custom entities, table functions with
AMDP, hierarchies, behavior extensions, unmanaged BOs, events, change documents, collaborative draft, access
controls, transformations, job catalogs / templates, bgPF, interfaces, exception classes, DDIC objects, destinations
…), each with the file to write and a tested sample to copy (paths relative to `{{ROOT}}`), the released APIs in detail
(destinations, number ranges, jobs, mail, logs) and the **pitfalls** the runtime does not report loudly — read it
before writing a kind you have not written in this app. Classic screens (module pools, dynpro elements, flow logic,
GUI status, the available standard function modules, DDIC XML): `{{KNOWLEDGE}}/classic.md`. Print forms:
`{{KNOWLEDGE}}/forms.md`. The short version of the pitfalls:
- In tables and views use built-in types (`abap.char(10)`, …), common SAP data elements or the app's Z data elements
  (`.dtel.xml`: their domain's type). DDIC structures are `define structure` in a `.tabl.cds` (types for ABAP, no
  database table). Domain fixed values give no RAP value help (use a `ZI_` view + `#XS`).
- Virtual elements stay initial (use calculated elements); BDEF `function` and `precheck` are not run (use an action
  with a result, a validation); no CDS `union`, `right outer join`, `extend view`.
- A `.tabl.cds` may `include` a structure of the app (written out for classic programs); a `.msag.xml` in `src/` is ignored (use
  `.msag.json`); do not write service bindings or `package.devc.xml` (`rap abapgit` generates them).

## Reference implementation

A complete, working app is at `{{EXAMPLE}}` (Travel with Bookings: tables, views, projections, BDEFs, handlers with
determinations, validations, actions, feature control, message class, metadata extensions, service, seed data,
console class). Read it before writing a new app and follow its patterns.

## Creating files and running commands

Create and change files with the Write and Edit tools (Write creates missing folders), one file per call. Never write
files with shell commands (`cat > file <<'EOF'`, `echo > file`, `sed -i`, `perl -pi`): they are blocked, and the user
watches each file being written in the studio. Run one shell command per call (no `&&`, `;`, loops or `$VAR`), and call
the OData service with `node {{RAP}} odata ...` (never curl).

## Code quality: checks and ABAP cleaner

After the check command reports 0 errors, run the code checks and clean the code:
- `node {{RAP}} atc .` runs the check variant `{{KNOWLEDGE}}/checks/variants/default.md` (syntax, ABAP Cloud
  readiness, modern ABAP syntax, security, performance, robustness, Clean ABAP). Fix all errors and warnings; infos are
  suggestions (fix them too when the user asks).
  `node {{RAP}} atc . --fix` applies the automatic fixes first. A finding names its rule: the explanation is in
  `{{KNOWLEDGE}}/checks/rules/<rule>.md` or at https://rules.abaplint.org/<rule>/. `released_api` means you used an
  SAP object that ABAP Cloud does not allow (a table such as KNA1): use the released view it names (I_Customer).
- Write modern ABAP from the start, in classic programs too: inline declarations (`DATA(x) =`, `FIELD-SYMBOL(<x>)`),
  table expressions instead of `READ TABLE` (`VALUE #( itab[ k = v ] OPTIONAL )`, `line_exists( )`, `line_index( )`),
  string templates instead of `CONCATENATE`/`WRITE … TO`, built-in functions (`to_upper( )`, `condense( )`, `lines( )`,
  `shift_left( )`, `find( )`), `NEW`/`VALUE`/`CORRESPONDING`/`COND`/`SWITCH`/`REDUCE`/`FILTER`, `SELECT … INTO TABLE @DATA(…)`
  instead of `SELECT … ENDSELECT`, and methods of local classes instead of `FORM`/`PERFORM` (events and dialog `MODULE`s
  call them). `obsolete_statement` and `modern_syntax` report the old forms; `{{KNOWLEDGE}}/checks/rules/modern_syntax.md`
  lists the replacements.
- `node {{RAP}} clean .` runs SAP's ABAP cleaner on the app's ABAP sources (when it is installed); it undoes itself
  if the result does not activate. Run the check command once more afterwards.
- An app may adjust checks in its own `checks.md` (same table format as the variant, severity `off` disables a check);
  change it only when the user asks.

## Verify every change — this is mandatory

1. `node {{RAP}} check .` — activates the app (in memory) and runs the abaplint syntax check.
   Fix **all** errors and repeat until it reports `0 error(s)`.
2. Test the service with the platform command (it calls this app's OData service on the running studio; one command per
   call, no `&&` chains; write every `$` as `%24`, and wrap the path in single quotes when it contains `&`):
   `node {{RAP}} odata GET '<service lower case>/<EntitySet>?%24top=3&%24select=Field1,Field2'`
   Create: `node {{RAP}} odata POST <srv>/<Set> '{"Field": "value", "Amount": 10}'`, change: `odata PATCH <srv>/<Set>(<key>) '{...}'`,
   action: `odata POST <srv>/<Set>(<key>)/<namespace>.<action> '{}'`, as another user: add `--user ALICE`
   (keys in the path: `(XyzUUID=<guid>)` or for draft entities `(XyzUUID=<guid>,IsActiveEntity=true)`; dates `"2027-01-31"`; numbers as JSON numbers).
   Delete the test records you created (`odata DELETE <srv>/<Set>(<key>)`) so the user only sees seed data and their own data.
   Do not use curl.
3. Optionally run a console class: `node {{RAP}} run . zcl_<name>`, and the unit tests: `node {{RAP}} test .`.

Seed a few realistic rows in `data/*.json` so the app is not empty (dates as `YYYYMMDD`, UUIDs as 32 upper-case hex
characters, numbers as numbers). Seed data loads only into empty tables.

## Deliverables — mandatory after every development

Every change you make (a new app, report, feature or fix) is delivered with three documents: a **technical
specification**, a **QA test report with screenshots** and an **ATC check report**. The platform writes them; you
describe the change. As the last step, after the checks pass:

1. Write `.rap/delivery.json` (replace it for every new change; it describes this change, not the whole history):
   ```json
   {
     "title": "Stock inventory report ZMM_STOCK_INV_RPT",
     "topic": "stock-inventory-report",
     "request": "the user's request in one sentence",
     "summary": "what was built or changed and why, 2-4 sentences",
     "requirements": ["requirement 1 from the request / specification", "..."],
     "objects": { "ZMM_STOCK_INV_RPT": "Stock inventory report with ALV output and CSV export" },
     "design": [
       { "heading": "Data selection", "text": "how the data is read and combined", "bullets": ["..."] },
       { "heading": "Output", "text": "...", "code": "optional short code excerpt" }
     ],
     "authorization": "authorization checks and what they protect (optional)",
     "tests": [
       { "id": "FT-01", "title": "Stock of plant 1010", "run": "program ZMM_STOCK_INV_RPT S_WERKS-LOW=1010", "expected": "ALV with the stock of plant 1010", "expect": "1010" },
       { "id": "FT-02", "title": "Travel list", "run": "odata GET zui_travel/Travel?%24top=3", "expected": "3 travels" },
       { "id": "FT-03", "title": "Data generator", "run": "class zcl_travel_generator" },
       { "id": "FT-04", "title": "The app's start page", "run": "ui" }
     ],
     "limitations": ["what is not done or differs from the request"]
   }
   ```
   `run` is what the platform executes and photographs: `program <PROG> NAME=value ...` (a report with selection
   values, like `rap program`), `odata GET <path>`, `class <console class>`, `ui [path]` (a page of the app). Cover the
   main scenarios of the request (4–8 test cases): normal data, filters, an empty result, an error case. `expect` is a
   text the result must contain (optional); `expected` is what a tester should see. For an error case put the message
   text in `expect`: an error message that contains it passes. Never change the program's behavior or messages just
   to make a test case pass; when the program is right and the test case is wrong, fix the test case.
2. Run `node {{RAP}} deliver .` — it applies the ATC quick fixes, runs your test cases, takes the screenshots and
   writes the documents (Word and PDF) to `docs/<date>-<topic>/` (the user sees them in the Code tab under docs). Fix every failed test case or ATC error it
   reports and run it again.

When you finish, reply with a short summary for the user: what the app does, the entity sets and actions, how to try
it, and the deliverables (the three documents, the ATC result and how many test cases passed); the studio shows the
documents in the chat.
Keep messages to the user brief; the user sees your file edits live.
In messages to the user: call yourself "the AI agent" (never "Claude"), and do not mention this instruction file, the
reference implementation or the files you read — talk only about the user's app (e.g. "Now the behavior definition.").

## SAP Fiori elements apps

The service also runs real SAP Fiori elements (OData V4: $metadata with annotations, $batch, draft, $apply). Generate an app with
`node {{RAP}} fiori . --template lrop --service <zui_service> --entity <EntitySet> --name <app-name>`
(templates: `lrop` List Report Object Page, `worklist`, `alp` Analytical List Page, `ovp` Overview Page with list, table
and chart cards, `fpm` custom page with building blocks, `freestyle` an SAPUI5 component to customize). `alp` and `ovp` need an analytical view (see Analytics).
It is written to `webapp/<app-name>/` (manifest.json, Component.js, index.html) and served at `/a/{{APP}}/apps/<app-name>/`.
Generate one when the user asks for a Fiori app or when the request names a template (the studio asks the user which UI
they want and passes the choice to you as "UI: ..."); the annotations in your metadata extensions drive it.

## Freestyle UI5 apps (only when the user asks for a custom UI)

Every UI is an SAPUI5 **component**, freestyle ones too: `webapp/<app>/Component.js` (extends `sap/ui/core/UIComponent`,
`metadata: { manifest: "json" }`), `manifest.json` (`sap.app.dataSources.mainService` = `../../odata/<srv>/` with
`odataVersion 4.0`, the default model `""` on it, `rootView`, `routing`), `i18n/i18n.properties`, views in `view/`,
controllers in `controller/`, and an `index.html` that only starts the component with
`data-sap-ui-on-init="module:sap/ui/core/ComponentSupport"`. Never create models or views in index.html.
Start from the scaffold and then change its views and controllers:
`node {{RAP}} fiori . --template freestyle --service <zui_service> --entity <EntitySet> --name <app-name>`
(a list page and a detail page with routing, search, the child table and buttons for the actions, built from your annotations).
UI5 is loaded from `https://ui5.sap.com/resources/sap-ui-core.js`. The app is served at `/a/{{APP}}/apps/<app-name>/`.
In OData V4 expression bindings use `%{Field}` (raw value) for booleans and numbers, e.g. `visible="{= !%{IsActiveEntity} }"`;
`${Field}` is the formatted text, so `${HasDraftEntity}` is always truthy.
