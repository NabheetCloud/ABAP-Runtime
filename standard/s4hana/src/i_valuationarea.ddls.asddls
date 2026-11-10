@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Valuation Area'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_ValuationArea
  as select from t001k
{
  key bwkey as ValuationArea,
      bukrs as CompanyCode
}
