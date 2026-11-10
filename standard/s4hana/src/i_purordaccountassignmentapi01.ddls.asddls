@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Purchase Order Account Assignment (API)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PurOrdAccountAssignmentAPI01
  as select from ekkn
{
  key ebeln as PurchaseOrder,
  key ebelp as PurchaseOrderItem,
  key zekkn as AccountAssignmentNumber,
      sakto as GLAccount,
      kostl as CostCenter,
      aufnr as OrderID,
      ps_psp_pnr as WBSElementInternalID,
      anln1 as MasterFixedAsset,
      vbeln as SalesDocument,
      prctr as ProfitCenter,
      anln2 as FixedAsset,
      menge as Quantity
}
