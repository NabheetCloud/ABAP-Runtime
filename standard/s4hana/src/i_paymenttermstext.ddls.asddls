@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Payment Terms - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PaymentTermsText
  as select from tvzbt
{
  key zterm as PaymentTerms,
  key spras as Language,
      vtext as PaymentTermsName
}
