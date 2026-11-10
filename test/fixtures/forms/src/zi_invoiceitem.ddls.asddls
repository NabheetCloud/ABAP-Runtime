@EndUserText.label: 'Invoice item'
define view entity ZI_InvoiceItem as select from zinv_item
{
  key invoice_id  as InvoiceId,
  key item_no     as ItemNo,
      description as Description,
      quantity    as Quantity,
      amount      as Amount
}
