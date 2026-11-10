@EndUserText.label : 'Sales Order Customer'
define table zsocustomer_a {
  key client      : abap.clnt not null;
  key customer_id : abap.numc(6) not null;
  name            : abap.char(80);
  city            : abap.char(40);
  country_code    : abap.char(3);
  email           : abap.char(256);
}
