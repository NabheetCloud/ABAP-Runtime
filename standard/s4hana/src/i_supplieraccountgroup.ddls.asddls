@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Supplier Account Group'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_SupplierAccountGroup
  as select from t077k
  association [0..*] to I_SupplierAccountGroupText as _Text on $projection.SupplierAccountGroup = _Text.SupplierAccountGroup
{
  key ktokk as SupplierAccountGroup,
      numkr as NumberRangeInterval,
    _Text
}
