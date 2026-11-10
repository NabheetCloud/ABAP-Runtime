@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Division'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Division
  as select from tspa
  association [0..*] to I_DivisionText as _Text on $projection.Division = _Text.Division
{
  key spart as Division,
    _Text
}
