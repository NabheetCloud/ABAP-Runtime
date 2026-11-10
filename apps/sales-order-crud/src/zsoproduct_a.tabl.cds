@EndUserText.label : 'Sales Order Product'
define table zsoproduct_a {
  key client    : abap.clnt not null;
  key product_id : abap.char(10) not null;
  name          : abap.char(80);
  category      : abap.char(40);
  @Semantics.amount.currencyCode : 'zsoproduct_a.currency_code'
  price         : abap.curr(16,2);
  currency_code : abap.cuky;
  base_unit     : abap.unit(3);
}
