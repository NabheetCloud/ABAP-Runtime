@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Measuring Point'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MeasuringPoint
  as select from imptt
{
  key point as MeasuringPoint,
      mpobj as MeasuringPointObject,
      atinn as CharcInternalID,
      equnr as Equipment,
      tplnr as FunctionalLocation,
      indct as IsCounter,
      mrmax as MeasurementRangeUpperLimit,
      mrmin as MeasurementRangeLowerLimit,
      psort as MeasuringPointPositionNumber
}
