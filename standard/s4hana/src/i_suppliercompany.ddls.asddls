@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Company'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SupplierCompany
  as select from lfb1
{
  key lifnr as Supplier,
  key bukrs as CompanyCode,
      akont as ReconciliationAccount,
      zterm as PaymentTerms,
      loevm as DeletionIndicator
}
