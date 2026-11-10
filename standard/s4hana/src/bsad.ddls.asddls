@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer cleared items (compatibility view of BSEG)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity BSAD
  as select from bseg
{
  key bukrs as bukrs,
  key kunnr as kunnr,
  key gjahr as gjahr,
  key belnr as belnr,
  key buzei as buzei,
      augdt as augdt,
      augbl as augbl,
      zuonr as zuonr,
      h_budat as budat,
      h_bldat as bldat,
      h_waers as waers,
      h_blart as blart,
      bschl as bschl,
      shkzg as shkzg,
      dmbtr as dmbtr,
      wrbtr as wrbtr,
      hkont as saknr,
      zterm as zterm,
      zfbdt as zfbdt,
      mwskz as mwskz,
      sgtxt as sgtxt,
      prctr as prctr
}
where koart = 'D' and augbl <> ''
