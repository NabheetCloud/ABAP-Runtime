@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bank'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_Bank_2
  as select from bnka
{
  key banks as BankCountry,
  key bankl as BankInternalID,
      banka as BankName,
      ort01 as CityName,
      stras as StreetName,
      swift as SWIFTCode,
      loevm as IsMarkedForDeletion
}
