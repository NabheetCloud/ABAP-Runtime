@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Routing'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Routing
  as select from plko
{
  key plnty as BillOfOperationsType,
  key plnnr as BillOfOperationsGroup,
  key plnal as BillOfOperationsVariant,
  key zaehl as BOOInternalVersionCounter,
      werks as Plant,
      verwe as WorkCenterCategoryCode,
      statu as PurchasingDocumentStatus,
      ktext as BillOfOperationsDesc,
      plnme as BillOfOperationsUnit
}
