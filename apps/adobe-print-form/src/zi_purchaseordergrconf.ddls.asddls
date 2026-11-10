@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Goods receipt confirmation of a purchase order'
define view entity ZI_PurchaseOrderGRConf
  as select from zpodoc_gr_a
{
  key po_number    as PONumber,
      received_by  as ReceivedBy,
      received_on  as ReceivedOn,
      complete     as IsComplete,
      remark       as Remark,
      is_signed    as IsSigned,
      signer       as Signer,
      confirmed_at as ConfirmedAt
}
