@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Inspection Lot'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_InspectionLot
  as select from qals
{
  key prueflos as InspectionLot,
      art as InspectionLotType,
      herkunft as InspectionLotOrigin,
      matnr as Material,
      charg as Batch,
      losmenge as InspectionLotQuantity,
      ebeln as PurchaseOrder,
      ebelp as PurchaseOrderItem,
      mblnr as MaterialDocument,
      mjahr as MaterialDocumentYear,
      zeile as MaterialDocumentItem,
      aufnr as OrderID,
      kdauf as SalesOrder,
      objnr as MaintObjectInternalID,
      lifnr as Supplier
}
