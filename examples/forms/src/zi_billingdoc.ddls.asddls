@EndUserText.label: 'Billing document (form data provider)'
@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]
define root view entity ZI_BillingDoc as select from zbil_head
  association [0..*] to ZI_BillingDocItem as _Item on $projection.BillingDoc = _Item.BillingDoc
{
  key billing_doc   as BillingDoc,
      status        as Status,
      customer_name as CustomerName,
      street        as Street,
      postal_code   as PostalCode,
      city          as City,
      country       as Country,
      billing_date  as BillingDate,
      due_date      as DueDate,
      currency      as Currency,
      tax_rate      as TaxRate,
      _Item
}
