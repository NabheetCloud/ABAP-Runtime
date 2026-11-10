@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Segment'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Segment
  as select from fagl_segm
{
  key segment as Segment,
      name as SegmentName
}
