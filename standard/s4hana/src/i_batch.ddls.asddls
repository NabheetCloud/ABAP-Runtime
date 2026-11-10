@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Batch'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Batch
  as select from mch1
{
  key matnr as Material,
  key charg as Batch,
      lifnr as Supplier,
      ernam as CreatedByUser
}
