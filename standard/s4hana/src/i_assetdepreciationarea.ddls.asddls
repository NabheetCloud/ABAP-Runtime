@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Asset Depreciation Area'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_AssetDepreciationArea
  as select from anlb
{
  key bukrs as CompanyCode,
  key anln1 as MasterFixedAsset,
  key anln2 as FixedAsset,
  key afabe as AssetDepreciationArea,
  key bdatu as ValidityEndDate,
      afasl as DepreciationKey,
      ndjar as PlannedUsefulLifeInYears,
      ndper as PlannedUsefulLifeInPeriods,
      afabg as DepreciationStartDate
}
