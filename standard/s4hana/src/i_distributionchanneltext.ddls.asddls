@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Distribution Channel - Text'
@VDM.viewType: #BASIC
@ObjectModel.dataCategory: #TEXT
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_DistributionChannelText
  as select from tvtwt
{
  key vtweg as DistributionChannel,
  key spras as Language,
      vtext as DistributionChannelName
}
