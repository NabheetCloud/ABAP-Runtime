@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Material document item (compatibility view of MATDOC)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity MSEG
  as select from matdoc
{
  key mblnr as mblnr,
  key mjahr as mjahr,
  key zeile as zeile,
      bwart as bwart,
      matnr as matnr,
      werks as werks,
      lgort as lgort,
      charg as charg,
      sobkz as sobkz,
      lifnr as lifnr,
      kunnr as kunnr,
      kdauf as kdauf,
      kdpos as kdpos,
      shkzg as shkzg,
      menge as menge,
      meins as meins,
      erfmg as erfmg,
      erfme as erfme,
      dmbtr as dmbtr,
      waers as waers,
      ebeln as ebeln,
      ebelp as ebelp,
      aufnr as aufnr,
      kostl as kostl,
      rsnum as rsnum,
      rspos as rspos,
      vbeln_im as vbeln_im,
      vbelp_im as vbelp_im,
      sjahr as sjahr,
      smbln as smbln,
      smblp as smblp,
      budat as budat
}
