@EndUserText.label: 'Billing document item'
define view entity ZI_BillingDocItem as select from zbil_item
{
  key billing_doc as BillingDoc,
  key item_no     as ItemNo,
      category    as Category,
      material    as Material,
      description as Description,
      quantity    as Quantity,
      unit        as Unit,
      unit_price  as UnitPrice
}
