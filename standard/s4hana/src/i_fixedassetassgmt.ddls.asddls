@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Fixed Asset Assignment'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FixedAssetAssgmt
  as select from anlz
{
  key bukrs as CompanyCode,
  key anln1 as MasterFixedAsset,
  key anln2 as FixedAsset,
  key bdatu as ValidityEndDate,
      adatu as ValidityStartDate,
      kostl as CostCenter,
      werks as Plant,
      prctr as ProfitCenter,
      pernr as Personnel
}
