@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales Order Partner'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SalesOrderPartner
  as select from vbpa
{
  key vbeln as SalesOrder,
  key posnr as SalesOrderItem,
  key parvw as PartnerFunction,
      kunnr as Customer,
      lifnr as Supplier,
      pernr as Personnel,
      adrnr as AddressID
}
where posnr = '000000'
