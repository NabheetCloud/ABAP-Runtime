@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Distribution Channel'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_DistributionChannel
  as select from tvtw
  association [0..*] to I_DistributionChannelText as _Text on $projection.DistributionChannel = _Text.DistributionChannel
{
  key vtweg as DistributionChannel,
    _Text
}
