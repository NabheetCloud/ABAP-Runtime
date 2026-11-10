@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Payment Terms'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_PaymentTerms
  as select from t052
  association [0..*] to I_PaymentTermsText as _Text on $projection.PaymentTerms = _Text.PaymentTerms
{
  key zterm as PaymentTerms,
      ztag1 as CashDiscount1Days,
      zprz1 as CashDiscount1Percent,
      ztag2 as CashDiscount2Days,
      zprz2 as CashDiscount2Percent,
      ztag3 as NetPaymentDays,
    _Text
}
