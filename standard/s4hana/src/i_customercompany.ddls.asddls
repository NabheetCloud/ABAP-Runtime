@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer Company'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CustomerCompany
  as select from knb1
{
  key kunnr as Customer,
  key bukrs as CompanyCode,
      akont as ReconciliationAccount,
      zterm as PaymentTerms,
      busab as AccountingClerk,
      loevm as DeletionIndicator
}
