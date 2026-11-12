@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Sale'
define root view entity ZR_Sale as select from zsale_a
{
  key sale_id as SaleId,
      region  as Region,
      amount  as Amount,
      owner   as Owner,
      case when owner = $session.user then 'X' else '' end as IsMine
}
