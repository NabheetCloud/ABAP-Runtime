@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material document header (compatibility view of MATDOC)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity MKPF
  as select from matdoc
{
  key mblnr as mblnr,
  key mjahr as mjahr,
      budat as budat,
      bldat as bldat,
      cpudt as cpudt,
      cputm as cputm,
      usnam as usnam,
      xblnr as xblnr,
      bktxt as bktxt,
      vgart as vgart
}
where zeile = '0001'
