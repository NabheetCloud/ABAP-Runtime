@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sales document header with status (compatibility view)'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity VBAKUK
  as select from vbak
{
  key vbeln as vbeln,
      vbtyp as vbtyp,
      auart as auart,
      vkorg as vkorg,
      kunnr as kunnr,
      gbstk as gbstk,
      lfstk as lfstk,
      fkstk as fkstk,
      abstk as abstk,
      cmgst as cmgst,
      bestk as bestk
}
