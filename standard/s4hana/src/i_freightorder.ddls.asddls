@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Freight Order'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_FreightOrder
  as select from /scmtms/d_torrot
{
  key db_key as TransportationOrderUUID,
      tor_id as TransportationOrder,
      tor_type as TransportationOrderType,
      lifecycle as TransportationOrderLifeCycleSts,
      tspid as Carrier,
      mtr as TransportationMode,
      labeltxt as TransportationOrderDesc,
      created_on as CreationDate
}
where tor_cat = 'TO'
