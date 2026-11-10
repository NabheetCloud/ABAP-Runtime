@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales document item with status (compatibility view)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity VBAPUK
  as select from vbap
{
  key vbeln as vbeln,
  key posnr as posnr,
      matnr as matnr,
      gbsta as gbsta,
      lfsta as lfsta,
      fksaa as fksaa,
      absta as absta
}
