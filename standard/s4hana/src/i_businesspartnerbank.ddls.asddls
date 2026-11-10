@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Business Partner Bank'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_BusinessPartnerBank
  as select from but0bk
{
  key partner as BusinessPartner,
  key bkvid as BankIdentification,
      banks as BankCountryKey,
      bankl as BankNumber,
      bankn as BankAccount,
      iban as IBAN
}
