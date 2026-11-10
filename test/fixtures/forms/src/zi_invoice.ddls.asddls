@EndUserText.label: 'Invoice (form data provider)'
@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]
define root view entity ZI_Invoice as select from zinv_head
  association [0..*] to ZI_InvoiceItem as _Item on $projection.InvoiceId = _Item.InvoiceId
{
  key invoice_id   as InvoiceId,
      customer     as Customer,
      invoice_date as InvoiceDate,
      currency     as Currency,
      _Item
}
