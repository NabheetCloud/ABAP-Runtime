@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Plant'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Plant
  as select from t001w
  association [0..1] to I_ValuationArea as _ValuationArea on $projection.ValuationArea = _ValuationArea.ValuationArea
{
  key werks as Plant,
      name1 as PlantName,
      bwkey as ValuationArea,
      kunnr as PlantCustomer,
      lifnr as PlantSupplier,
      fabkl as FactoryCalendar,
      ekorg as DefaultPurchasingOrganization,
      vkorg as SalesOrganization,
      vtweg as DistributionChannel,
      spart as Division,
      spras as Language,
      adrnr as AddressID,
      vlfkz as PlantCategory,
      ort01 as CityName,
      land1 as Country,
      regio as Region,
      pstlz as PostalCode,
      stras as StreetName,
    _ValuationArea
}
