@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer Account Group'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CustomerAccountGroup
  as select from t077d
  association [0..*] to I_CustomerAccountGroupText as _Text on $projection.CustomerAccountGroup = _Text.CustomerAccountGroup
{
  key ktokd as CustomerAccountGroup,
      numkr as NumberRangeInterval,
    _Text
}
