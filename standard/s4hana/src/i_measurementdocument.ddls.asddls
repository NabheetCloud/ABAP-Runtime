@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Measurement Document'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_MeasurementDocument
  as select from imrg
{
  key mdocm as MeasurementDocument,
      point as MeasuringPoint,
      idate as MeasurementDate,
      itime as MeasurementTime,
      recdv as MeasurementReading,
      readr as MeasurementReader,
      recdu as MeasurementReadingUnit
}
